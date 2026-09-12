#include "socket_server.h"

#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/un.h>
#include <unistd.h>

#include <cerrno>
#include <cstring>
#include <utility>

namespace untypo {

namespace {

constexpr std::uint32_t kAllowedModifiers = 0x0001 | 0x0002 | 0x0004 | 0x0008;

template <typename T>
bool PayloadAs(const std::vector<std::uint8_t>& payload, T& output) {
  if (payload.size() != sizeof(T)) return false;
  std::memcpy(&output, payload.data(), sizeof(T));
  return true;
}

int CloseFd(int fd) {
  if (fd < 0) return -1;
  close(fd);
  return -1;
}

}  // namespace

SocketServer::SocketServer() = default;

SocketServer::~SocketServer() { Stop(); }

bool SocketServer::Start(std::string socket_path, std::string token,
                         SocketCallbacks callbacks) {
  if (running_.exchange(true)) return false;
  socket_path_ = std::move(socket_path);
  token_ = std::move(token);
  callbacks_ = std::move(callbacks);
  if (!CreateAndListen()) {
    running_ = false;
    return false;
  }
  thread_ = std::thread([this] { Run(); });
  return true;
}

void SocketServer::Stop() {
  const bool was_running = running_.exchange(false);
  authenticated_ = false;
  if (client_fd_ >= 0) shutdown(client_fd_, SHUT_RDWR);
  if (listen_fd_ >= 0) shutdown(listen_fd_, SHUT_RDWR);
  if (was_running && thread_.joinable() &&
      thread_.get_id() != std::this_thread::get_id()) {
    thread_.join();
  }
  CloseClient();
  CloseListen();
  if (!socket_path_.empty()) unlink(socket_path_.c_str());
}

bool SocketServer::SendHotkey(HotkeyAction action) {
  if (!authenticated_) return false;
  const HotkeyEventPayload payload{action};
  return WriteFrame(MessageType::HotkeyEvent, &payload, sizeof(payload));
}

void SocketServer::Run() {
  if (AcceptClient() && Authenticate()) {
    while (running_) {
      MessageType type{};
      std::vector<std::uint8_t> payload;
      if (!ReadFrame(type, payload) || !Dispatch(type, payload)) break;
    }
  }

  running_ = false;
  authenticated_ = false;
  CloseClient();
  callbacks_.clear_selection();
  callbacks_.disconnected();
}

bool SocketServer::CreateAndListen() {
  unlink(socket_path_.c_str());
  listen_fd_ = socket(AF_UNIX, SOCK_STREAM, 0);
  if (listen_fd_ < 0) return false;

  sockaddr_un address{};
  address.sun_family = AF_UNIX;
  if (socket_path_.size() >= sizeof(address.sun_path)) {
    CloseListen();
    return false;
  }
  std::memcpy(address.sun_path, socket_path_.c_str(), socket_path_.size() + 1);

  if (bind(listen_fd_, reinterpret_cast<sockaddr*>(&address),
           sizeof(address)) != 0 ||
      chmod(socket_path_.c_str(), S_IRUSR | S_IWUSR) != 0 ||
      listen(listen_fd_, 1) != 0) {
    CloseListen();
    unlink(socket_path_.c_str());
    return false;
  }
  return true;
}

bool SocketServer::AcceptClient() {
  while (running_) {
    const int client = accept(listen_fd_, nullptr, nullptr);
    if (client >= 0) {
      client_fd_ = client;
      return true;
    }
    if (errno == EINTR) continue;
    return false;
  }
  return false;
}

bool SocketServer::Authenticate() {
  MessageType type{};
  std::vector<std::uint8_t> payload;
  if (!ReadFrame(type, payload) || type != MessageType::Authenticate ||
      payload.size() != token_.size()) {
    return false;
  }

  std::uint8_t difference = 0;
  for (std::size_t index = 0; index < payload.size(); ++index) {
    difference |= payload[index] ^ static_cast<std::uint8_t>(token_[index]);
  }
  if (difference != 0) return false;
  const bool sent = WriteFrame(MessageType::Authenticated, nullptr, 0);
  authenticated_ = sent;
  return sent;
}

bool SocketServer::Dispatch(MessageType type,
                            const std::vector<std::uint8_t>& payload) {
  if (type == MessageType::ConfigureHotkey) {
    HotkeyConfiguration configuration{};
    if (!PayloadAs(payload, configuration)) return false;
    if (configuration.virtual_key == 0 || configuration.virtual_key > 0xff ||
        (configuration.modifiers & ~kAllowedModifiers) != 0) {
      return false;
    }
    const HotkeyConfigurationResultPayload result =
        callbacks_.configure_hotkey(configuration);
    return WriteFrame(MessageType::HotkeyConfigured, &result, sizeof(result));
  }
  if (type == MessageType::CaptureTarget && payload.empty()) {
    const std::vector<std::uint8_t> target = callbacks_.capture_target();
    return WriteFrame(MessageType::TargetCaptured, target.data(),
                      static_cast<std::uint32_t>(target.size()));
  }
  if (type == MessageType::CaptureSelection && payload.empty()) {
    const auto selection = callbacks_.capture_selection();
    return WriteFrame(MessageType::SelectionCaptured, selection.data(),
                      static_cast<std::uint32_t>(selection.size()));
  }
  if (type == MessageType::ReplaceSelection && payload.empty()) {
    const auto result = callbacks_.replace_selection();
    return WriteFrame(MessageType::SelectionReplaced, &result, sizeof(result));
  }
  if (type == MessageType::ClearSelection && payload.empty()) {
    callbacks_.clear_selection();
    return WriteFrame(MessageType::SelectionCleared, nullptr, 0);
  }
  if (type == MessageType::Paste) {
    PasteRequestPayload request{};
    if (!PayloadAs(payload, request)) return false;
    const PasteResultPayload result = callbacks_.paste(request);
    return WriteFrame(MessageType::PasteResult, &result, sizeof(result));
  }
  if (type == MessageType::Ping && payload.empty()) {
    return WriteFrame(MessageType::Pong, nullptr, 0);
  }
  if (type == MessageType::Shutdown && payload.empty()) {
    callbacks_.clear_selection();
    callbacks_.shutdown();
    return false;
  }
  return false;
}

bool SocketServer::ReadFrame(MessageType& type,
                             std::vector<std::uint8_t>& payload) {
  FrameHeader header{};
  if (!ReadExact(&header, sizeof(header)) || header.magic != kProtocolMagic ||
      header.version != kProtocolVersion ||
      header.payload_bytes > kMaximumPayloadBytes) {
    return false;
  }
  type = static_cast<MessageType>(header.message_type);
  payload.resize(header.payload_bytes);
  return payload.empty() || ReadExact(payload.data(), header.payload_bytes);
}

bool SocketServer::ReadExact(void* data, std::uint32_t bytes) {
  auto* cursor = static_cast<std::uint8_t*>(data);
  std::uint32_t remaining = bytes;
  while (remaining > 0 && running_) {
    const ssize_t received = recv(client_fd_, cursor, remaining, 0);
    if (received < 0) {
      if (errno == EINTR) continue;
      return false;
    }
    if (received == 0) return false;
    cursor += received;
    remaining -= static_cast<std::uint32_t>(received);
  }
  return remaining == 0;
}

bool SocketServer::WriteFrame(MessageType type, const void* data,
                              std::uint32_t bytes) {
  if (!running_ || client_fd_ < 0 || bytes > kMaximumPayloadBytes) {
    return false;
  }
  const FrameHeader header{kProtocolMagic, kProtocolVersion,
                           static_cast<std::uint16_t>(type), bytes};
  std::scoped_lock lock(write_mutex_);
  return WriteExact(&header, sizeof(header)) &&
         (bytes == 0 || WriteExact(data, bytes));
}

bool SocketServer::WriteExact(const void* data, std::uint32_t bytes) {
  const auto* cursor = static_cast<const std::uint8_t*>(data);
  std::uint32_t remaining = bytes;
  while (remaining > 0 && running_) {
    const ssize_t written = send(client_fd_, cursor, remaining, 0);
    if (written < 0) {
      if (errno == EINTR) continue;
      return false;
    }
    if (written == 0) return false;
    cursor += written;
    remaining -= static_cast<std::uint32_t>(written);
  }
  return remaining == 0;
}

void SocketServer::CloseClient() {
  client_fd_ = CloseFd(client_fd_);
}

void SocketServer::CloseListen() {
  listen_fd_ = CloseFd(listen_fd_);
}

}  // namespace untypo
