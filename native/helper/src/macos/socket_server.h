#pragma once

#include <atomic>
#include <functional>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include "../protocol.h"

namespace untypo {

struct SocketCallbacks {
  std::function<HotkeyConfigurationResultPayload(const HotkeyConfiguration&)>
      configure_hotkey;
  std::function<std::vector<std::uint8_t>()> capture_target;
  std::function<std::vector<std::uint8_t>()> capture_selection;
  std::function<PasteResultPayload()> replace_selection;
  std::function<void()> clear_selection;
  std::function<PasteResultPayload(const PasteRequestPayload&)> paste;
  std::function<void()> shutdown;
  std::function<void()> disconnected;
};

class SocketServer {
 public:
  SocketServer();
  ~SocketServer();

  SocketServer(const SocketServer&) = delete;
  SocketServer& operator=(const SocketServer&) = delete;

  bool Start(std::string socket_path, std::string token,
             SocketCallbacks callbacks);
  void Stop();
  bool SendHotkey(HotkeyAction action);

 private:
  void Run();
  bool CreateAndListen();
  bool AcceptClient();
  bool Authenticate();
  bool Dispatch(MessageType type, const std::vector<std::uint8_t>& payload);
  bool ReadFrame(MessageType& type, std::vector<std::uint8_t>& payload);
  bool ReadExact(void* data, std::uint32_t bytes);
  bool WriteFrame(MessageType type, const void* data, std::uint32_t bytes);
  bool WriteExact(const void* data, std::uint32_t bytes);
  void CloseClient();
  void CloseListen();

  SocketCallbacks callbacks_;
  std::atomic<bool> authenticated_{false};
  int client_fd_ = -1;
  int listen_fd_ = -1;
  std::string socket_path_;
  std::atomic<bool> running_{false};
  std::string token_;
  std::thread thread_;
  std::mutex write_mutex_;
};

}  // namespace untypo
