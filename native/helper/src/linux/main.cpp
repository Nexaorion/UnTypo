#include <algorithm>
#include <cctype>
#include <condition_variable>
#include <csignal>
#include <mutex>
#include <string>

#include "hotkey_monitor.h"
#include "socket_server.h"
#include "window_target.h"

namespace {
struct Arguments {
  std::string socket_path;
  std::string token;
  bool self_test = false;
};

Arguments ParseArguments(int argc, char** argv) {
  Arguments result;
  for (int index = 1; index < argc; ++index) {
    const std::string value = argv[index] == nullptr ? "" : argv[index];
    if (value == "--self-test") result.self_test = true;
    else if (value == "--pipe" && index + 1 < argc) result.socket_path = argv[++index];
    else if (value == "--token" && index + 1 < argc) result.token = argv[++index];
  }
  return result;
}

bool ValidArguments(const Arguments& arguments) {
  const auto slash = arguments.socket_path.find_last_of('/');
  const auto name = slash == std::string::npos ? "" : arguments.socket_path.substr(slash + 1);
  return slash != std::string::npos && arguments.socket_path.size() < 240 &&
         arguments.socket_path.find("..") == std::string::npos &&
         (name.starts_with("untypo-") || name.starts_with("u-")) &&
         name.ends_with(".sock") && arguments.token.size() == 64 &&
         std::all_of(arguments.token.begin(), arguments.token.end(), [](char value) {
           return std::isxdigit(static_cast<unsigned char>(value)) != 0;
         });
}
}  // namespace

int main(int argc, char** argv) {
  std::signal(SIGPIPE, SIG_IGN);
  const auto arguments = ParseArguments(argc, argv);
  if (arguments.self_test) return sizeof(untypo::FrameHeader) == 12 ? 0 : 1;
  if (!ValidArguments(arguments)) return 2;

  untypo::WindowTargetService targets;
  untypo::SocketServer socket;
  untypo::HotkeyMonitor hotkey;
  std::mutex mutex;
  std::condition_variable condition;
  bool stopping = false;
  untypo::SocketCallbacks callbacks;
  callbacks.configure_hotkey = [&hotkey](const auto& value) { return hotkey.Configure(value); };
  callbacks.capture_target = [&targets] { return targets.Capture(); };
  callbacks.capture_selection = [&targets] { return targets.CaptureSelection(); };
  callbacks.replace_selection = [&targets] { return targets.ReplaceSelection(); };
  callbacks.clear_selection = [&targets] { targets.ClearSelection(); };
  callbacks.paste = [&targets](const auto& request) { return targets.Paste(request); };
  callbacks.shutdown = [&] {
    std::lock_guard lock(mutex);
    stopping = true;
    condition.notify_one();
  };
  callbacks.disconnected = callbacks.shutdown;
  hotkey.Install([&socket](untypo::HotkeyAction action) { socket.SendHotkey(action); });
  if (!socket.Start(arguments.socket_path, arguments.token, std::move(callbacks))) return 3;
  {
    std::unique_lock lock(mutex);
    condition.wait(lock, [&] { return stopping; });
  }
  hotkey.Uninstall();
  socket.Stop();
  return 0;
}
