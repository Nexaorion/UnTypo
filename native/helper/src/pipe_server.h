#pragma once

#include <Windows.h>

#include <atomic>
#include <functional>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include "protocol.h"

namespace untypo {

struct PipeCallbacks {
  std::function<HotkeyConfigurationResultPayload(
      const HotkeyConfiguration&)>
      configure_hotkey;
  std::function<std::vector<std::uint8_t>()> capture_target;
  std::function<PasteResultPayload(const PasteRequestPayload&)> paste;
  std::function<void()> shutdown;
  std::function<void()> disconnected;
};

class PipeServer {
 public:
  PipeServer();
  ~PipeServer();

  PipeServer(const PipeServer&) = delete;
  PipeServer& operator=(const PipeServer&) = delete;

  bool Start(std::wstring pipe_name, std::string token, PipeCallbacks callbacks);
  void Stop();
  bool SendHotkey(HotkeyAction action);

 private:
  void Run();
  bool CreatePipe();
  bool ConnectClient();
  bool Authenticate();
  bool Dispatch(MessageType type, const std::vector<std::uint8_t>& payload);
  bool ReadFrame(MessageType& type, std::vector<std::uint8_t>& payload);
  bool ReadExact(void* data, std::uint32_t bytes);
  bool WriteFrame(MessageType type, const void* data, std::uint32_t bytes);
  bool WriteExact(const void* data, std::uint32_t bytes);

  PipeCallbacks callbacks_;
  std::atomic<bool> authenticated_ = false;
  HANDLE pipe_ = INVALID_HANDLE_VALUE;
  std::wstring pipe_name_;
  std::atomic<bool> running_ = false;
  std::string token_;
  std::thread thread_;
  std::mutex write_mutex_;
};

}
