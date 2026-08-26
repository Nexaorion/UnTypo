#include "pipe_server.h"

#include <Sddl.h>
#include <objbase.h>

#include <cstring>
#include <memory>
#include <utility>

namespace untypo {

namespace {

struct LocalFreeDeleter {
  void operator()(void* value) const {
    if (value != nullptr) LocalFree(value);
  }
};

using LocalPointer = std::unique_ptr<void, LocalFreeDeleter>;

std::wstring CurrentUserSecurityDescriptor() {
  HANDLE token = nullptr;
  if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token)) return {};

  DWORD required = 0;
  GetTokenInformation(token, TokenUser, nullptr, 0, &required);
  if (required == 0) {
    CloseHandle(token);
    return {};
  }

  auto buffer = std::make_unique<std::uint8_t[]>(required);
  if (!GetTokenInformation(token, TokenUser, buffer.get(), required, &required)) {
    CloseHandle(token);
    return {};
  }
  CloseHandle(token);

  const auto* user = reinterpret_cast<const TOKEN_USER*>(buffer.get());
  LPWSTR sid_text = nullptr;
  if (!ConvertSidToStringSidW(user->User.Sid, &sid_text)) return {};
  LocalPointer sid_owner(sid_text);
  return L"D:P(A;;GA;;;" + std::wstring(sid_text) + L")";
}

template <typename T>
bool PayloadAs(const std::vector<std::uint8_t>& payload, T& output) {
  if (payload.size() != sizeof(T)) return false;
  std::memcpy(&output, payload.data(), sizeof(T));
  return true;
}

}

PipeServer::PipeServer() = default;

PipeServer::~PipeServer() { Stop(); }

bool PipeServer::Start(std::wstring pipe_name, std::string token,
                       PipeCallbacks callbacks) {
  if (running_.exchange(true)) return false;
  pipe_name_ = std::move(pipe_name);
  token_ = std::move(token);
  callbacks_ = std::move(callbacks);
  thread_ = std::thread([this] { Run(); });
  return true;
}

void PipeServer::Stop() {
  const bool was_running = running_.exchange(false);
  authenticated_ = false;
  if (was_running && pipe_ != INVALID_HANDLE_VALUE) {
    CancelIoEx(pipe_, nullptr);
    DisconnectNamedPipe(pipe_);
    CloseHandle(pipe_);
    pipe_ = INVALID_HANDLE_VALUE;
  }
  if (thread_.joinable() && thread_.get_id() != std::this_thread::get_id()) {
    thread_.join();
  }
}

bool PipeServer::SendHotkey(HotkeyAction action) {
  if (!authenticated_) return false;
  const HotkeyEventPayload payload{action};
  return WriteFrame(MessageType::HotkeyEvent, &payload, sizeof(payload));
}

void PipeServer::Run() {
  const HRESULT com_result = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  if (!CreatePipe()) {
    running_ = false;
    if (SUCCEEDED(com_result)) CoUninitialize();
    callbacks_.disconnected();
    return;
  }

  if (ConnectClient() && Authenticate()) {
    while (running_) {
      MessageType type{};
      std::vector<std::uint8_t> payload;
      if (!ReadFrame(type, payload) || !Dispatch(type, payload)) break;
    }
  }

  running_ = false;
  authenticated_ = false;
  if (pipe_ != INVALID_HANDLE_VALUE) {
    FlushFileBuffers(pipe_);
    DisconnectNamedPipe(pipe_);
    CloseHandle(pipe_);
    pipe_ = INVALID_HANDLE_VALUE;
  }
  if (SUCCEEDED(com_result)) CoUninitialize();
  callbacks_.disconnected();
}

bool PipeServer::CreatePipe() {
  const std::wstring sddl = CurrentUserSecurityDescriptor();
  if (sddl.empty()) return false;

  PSECURITY_DESCRIPTOR raw_descriptor = nullptr;
  if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(
          sddl.c_str(), SDDL_REVISION_1, &raw_descriptor, nullptr)) {
    return false;
  }
  LocalPointer descriptor(raw_descriptor);
  SECURITY_ATTRIBUTES attributes{};
  attributes.nLength = sizeof(attributes);
  attributes.lpSecurityDescriptor = raw_descriptor;
  attributes.bInheritHandle = FALSE;

  pipe_ = CreateNamedPipeW(
      pipe_name_.c_str(), PIPE_ACCESS_DUPLEX | FILE_FLAG_FIRST_PIPE_INSTANCE |
                              FILE_FLAG_OVERLAPPED,
      PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS,
      1, 64 * 1024, 64 * 1024, 0, &attributes);
  return pipe_ != INVALID_HANDLE_VALUE;
}

bool PipeServer::ConnectClient() {
  OVERLAPPED operation{};
  operation.hEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  if (operation.hEvent == nullptr) return false;

  bool connected = ConnectNamedPipe(pipe_, &operation) != FALSE;
  if (!connected) {
    const DWORD error = GetLastError();
    if (error == ERROR_PIPE_CONNECTED) {
      connected = true;
    } else if (error == ERROR_IO_PENDING &&
               WaitForSingleObject(operation.hEvent, INFINITE) ==
                   WAIT_OBJECT_0) {
      DWORD transferred = 0;
      connected = GetOverlappedResult(pipe_, &operation, &transferred, FALSE) !=
                  FALSE;
    }
  }
  CloseHandle(operation.hEvent);
  return connected;
}

bool PipeServer::Authenticate() {
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

bool PipeServer::Dispatch(MessageType type,
                          const std::vector<std::uint8_t>& payload) {
  if (type == MessageType::ConfigureHotkey) {
    HotkeyConfiguration configuration{};
    if (!PayloadAs(payload, configuration)) return false;
    constexpr std::uint32_t allowed_modifiers =
        MOD_ALT | MOD_CONTROL | MOD_SHIFT | MOD_WIN;
    if (configuration.virtual_key == 0 || configuration.virtual_key > 0xff ||
        (configuration.modifiers & ~allowed_modifiers) != 0) {
      return false;
    }
    const HotkeyConfigurationResultPayload result =
        callbacks_.configure_hotkey(configuration);
    return WriteFrame(MessageType::HotkeyConfigured, &result, sizeof(result));
  }
  if (type == MessageType::CaptureTarget && payload.empty()) {
    const TargetSnapshotPayload target = callbacks_.capture_target();
    return WriteFrame(MessageType::TargetCaptured, &target, sizeof(target));
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
    callbacks_.shutdown();
    return false;
  }
  return false;
}

bool PipeServer::ReadFrame(MessageType& type,
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

bool PipeServer::ReadExact(void* data, std::uint32_t bytes) {
  auto* cursor = static_cast<std::uint8_t*>(data);
  std::uint32_t remaining = bytes;
  while (remaining > 0 && running_) {
    OVERLAPPED operation{};
    operation.hEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    if (operation.hEvent == nullptr) return false;

    DWORD received = 0;
    bool completed =
        ReadFile(pipe_, cursor, remaining, &received, &operation) != FALSE;
    if (!completed && GetLastError() == ERROR_IO_PENDING &&
        WaitForSingleObject(operation.hEvent, INFINITE) == WAIT_OBJECT_0) {
      completed = GetOverlappedResult(pipe_, &operation, &received, FALSE) !=
                  FALSE;
    }
    CloseHandle(operation.hEvent);
    if (!completed || received == 0) {
      return false;
    }
    cursor += received;
    remaining -= received;
  }
  return remaining == 0;
}

bool PipeServer::WriteFrame(MessageType type, const void* data,
                            std::uint32_t bytes) {
  if (!running_ || pipe_ == INVALID_HANDLE_VALUE || bytes > kMaximumPayloadBytes) {
    return false;
  }
  const FrameHeader header{kProtocolMagic, kProtocolVersion,
                           static_cast<std::uint16_t>(type), bytes};
  std::scoped_lock lock(write_mutex_);
  return WriteExact(&header, sizeof(header)) &&
         (bytes == 0 || WriteExact(data, bytes));
}

bool PipeServer::WriteExact(const void* data, std::uint32_t bytes) {
  const auto* cursor = static_cast<const std::uint8_t*>(data);
  std::uint32_t remaining = bytes;
  while (remaining > 0 && running_) {
    OVERLAPPED operation{};
    operation.hEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    if (operation.hEvent == nullptr) return false;

    DWORD written = 0;
    bool completed =
        WriteFile(pipe_, cursor, remaining, &written, &operation) != FALSE;
    if (!completed && GetLastError() == ERROR_IO_PENDING &&
        WaitForSingleObject(operation.hEvent, INFINITE) == WAIT_OBJECT_0) {
      completed = GetOverlappedResult(pipe_, &operation, &written, FALSE) !=
                  FALSE;
    }
    CloseHandle(operation.hEvent);
    if (!completed || written == 0) {
      return false;
    }
    cursor += written;
    remaining -= written;
  }
  return remaining == 0;
}

}
