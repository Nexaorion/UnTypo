#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>

#include <CoreFoundation/CoreFoundation.h>

#include <algorithm>
#include <cctype>
#include <csignal>
#include <cstdlib>
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
    const std::string argument(argv[index] == nullptr ? "" : argv[index]);
    if (argument == "--self-test") {
      result.self_test = true;
    } else if (argument == "--pipe" && index + 1 < argc) {
      result.socket_path = argv[++index];
    } else if (argument == "--token" && index + 1 < argc) {
      result.token = argv[++index];
    }
  }
  return result;
}

bool ValidArguments(const Arguments& arguments) {
  const auto slash = arguments.socket_path.find_last_of('/');
  if (slash == std::string::npos || arguments.socket_path.size() > 240 ||
      arguments.socket_path.find("..") != std::string::npos ||
      arguments.socket_path.front() != '/') {
    return false;
  }
  const std::string name = arguments.socket_path.substr(slash + 1);
  const bool valid_name =
      name.starts_with("untypo-") && name.ends_with(".sock") && name.size() > 12;
  const bool valid_token =
      arguments.token.size() == 64 &&
      std::all_of(arguments.token.begin(), arguments.token.end(), [](char value) {
        return std::isxdigit(static_cast<unsigned char>(value)) != 0;
      });
  return valid_name && valid_token;
}

int RunSelfTest() {
  if (sizeof(untypo::FrameHeader) != 12 ||
      sizeof(untypo::HotkeyConfiguration) != 8 ||
      sizeof(untypo::HotkeyConfigurationResultPayload) != 4 ||
      sizeof(untypo::TargetSnapshotHeader) != 14 ||
      untypo::kProtocolVersion != 4) {
    return 1;
  }
  return 0;
}

void StopRunLoop() { CFRunLoopStop(CFRunLoopGetMain()); }

}  // namespace

int main(int argc, char** argv) {
  signal(SIGPIPE, SIG_IGN);
  const Arguments arguments = ParseArguments(argc, argv);
  if (arguments.self_test) return RunSelfTest();
  if (!ValidArguments(arguments)) return 2;

  [NSApplication sharedApplication];
  const char* skip_prompt = std::getenv("UNTYPO_SKIP_TCC_PROMPT");
  if ((skip_prompt == nullptr || skip_prompt[0] == '\0') &&
      !AXIsProcessTrusted()) {
    const void* keys[] = {kAXTrustedCheckOptionPrompt};
    const void* values[] = {kCFBooleanTrue};
    CFDictionaryRef options = CFDictionaryCreate(
        kCFAllocatorDefault, keys, values, 1, &kCFTypeDictionaryKeyCallBacks,
        &kCFTypeDictionaryValueCallBacks);
    if (options != nullptr) {
      AXIsProcessTrustedWithOptions(options);
      CFRelease(options);
    }
  }

  untypo::WindowTargetService targets;
  untypo::SocketServer server;
  untypo::HotkeyMonitor hotkey;

  untypo::SocketCallbacks callbacks;
  callbacks.configure_hotkey =
      [&hotkey](const untypo::HotkeyConfiguration& value) {
        return hotkey.Configure(value);
      };
  callbacks.capture_target = [&targets] { return targets.Capture(); };
  callbacks.capture_selection = [&targets] { return targets.CaptureSelection(); };
  callbacks.replace_selection = [&targets] { return targets.ReplaceSelection(); };
  callbacks.clear_selection = [&targets] { targets.ClearSelection(); };
  callbacks.paste = [&targets](const untypo::PasteRequestPayload& request) {
    return targets.Paste(request);
  };
  callbacks.shutdown = [] { StopRunLoop(); };
  callbacks.disconnected = [] { StopRunLoop(); };

  if (!hotkey.Install([&server](untypo::HotkeyAction action) {
        server.SendHotkey(action);
      })) {
    return 4;
  }
  if (!server.Start(arguments.socket_path, arguments.token,
                    std::move(callbacks))) {
    hotkey.Uninstall();
    return 3;
  }

  CFRunLoopRun();
  hotkey.Uninstall();
  server.Stop();
  return 0;
}
