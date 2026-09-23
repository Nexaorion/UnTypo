#include "window_target.h"

#include <algorithm>
#include <array>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <unistd.h>

namespace untypo {
namespace {
std::string RunCommand(const std::string& command) {
  std::array<char, 256> buffer{};
  std::string output;
  FILE* pipe = popen((command + " 2>/dev/null").c_str(), "r");
  if (pipe == nullptr) return {};
  while (fgets(buffer.data(), static_cast<int>(buffer.size()), pipe) != nullptr)
    output += buffer.data();
  pclose(pipe);
  while (!output.empty() && (output.back() == '\n' || output.back() == '\r')) output.pop_back();
  return output;
}

std::uint32_t ParseId(const std::string& value) {
  char* end = nullptr;
  const auto parsed = std::strtoull(value.c_str(), &end, 10);
  return end != value.c_str() && parsed <= 0xffffffffu ? static_cast<std::uint32_t>(parsed) : 0;
}

std::uint32_t WindowId() { return ParseId(RunCommand("xdotool getactivewindow")); }

std::uint32_t ProcessId(std::uint32_t window) {
  return window == 0 ? 0 : ParseId(RunCommand("xdotool getwindowpid " + std::to_string(window)));
}

void AppendUtf16(std::vector<std::uint8_t>& payload, const std::string& value) {
  const auto length = static_cast<std::uint16_t>(std::min<std::size_t>(value.size(), 512));
  payload.push_back(static_cast<std::uint8_t>(length & 0xff));
  payload.push_back(static_cast<std::uint8_t>(length >> 8));
  for (std::size_t index = 0; index < length; ++index) {
    payload.push_back(static_cast<std::uint8_t>(value[index]));
    payload.push_back(0);
  }
}
}  // namespace

std::vector<std::uint8_t> WindowTargetService::Capture() const {
  const auto window = WindowId();
  const auto process = ProcessId(window);
  const auto title = window == 0 ? "" : RunCommand("xdotool getwindowname " + std::to_string(window));
  const auto name = process == 0 ? "" : RunCommand("ps -p " + std::to_string(process) + " -o comm=");
  TargetSnapshotHeader header{window, process, static_cast<std::uint8_t>(process != 0), 0};
  std::vector<std::uint8_t> payload(sizeof(header));
  std::memcpy(payload.data(), &header, sizeof(header));
  AppendUtf16(payload, title);
  AppendUtf16(payload, name);
  return payload;
}

PasteResultPayload WindowTargetService::Paste(const PasteRequestPayload& request) const {
  const auto window = WindowId();
  const auto process = ProcessId(window);
  if (window == 0 || process == 0 || window != request.window_handle ||
      process != request.process_id || process == static_cast<std::uint32_t>(getpid()))
    return {PasteStatus::TargetChanged};
  return std::system("xdotool key --clearmodifiers ctrl+v >/dev/null 2>&1") == 0
             ? PasteResultPayload{PasteStatus::Success}
             : PasteResultPayload{PasteStatus::SendInputFailed};
}

std::vector<std::uint8_t> WindowTargetService::CaptureSelection() {
  return std::vector<std::uint8_t>(5, 0);
}
PasteResultPayload WindowTargetService::ReplaceSelection() { return {PasteStatus::NotEditable}; }
void WindowTargetService::ClearSelection() {}
}  // namespace untypo
