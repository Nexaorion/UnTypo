#include <Windows.h>
#include <Shellapi.h>

#include <algorithm>
#include <cctype>
#include <cstdint>
#include <string>
#include <vector>

#include "hotkey_monitor.h"
#include "pipe_server.h"
#include "protocol.h"
#include "window_target.h"

namespace {

struct Arguments {
  std::wstring pipe_name;
  std::string token;
  bool self_test = false;
};

std::string NarrowAscii(const std::wstring& value) {
  std::string result;
  result.reserve(value.size());
  for (const wchar_t character : value) {
    if (character > 0x7f) return {};
    result.push_back(static_cast<char>(character));
  }
  return result;
}

Arguments ParseArguments() {
  Arguments result;
  int count = 0;
  LPWSTR* values = CommandLineToArgvW(GetCommandLineW(), &count);
  if (values == nullptr) return result;
  for (int index = 1; index < count; ++index) {
    const std::wstring argument(values[index]);
    if (argument == L"--self-test") {
      result.self_test = true;
    } else if (argument == L"--pipe" && index + 1 < count) {
      result.pipe_name = values[++index];
    } else if (argument == L"--token" && index + 1 < count) {
      result.token = NarrowAscii(values[++index]);
    }
  }
  LocalFree(values);
  return result;
}

bool ValidArguments(const Arguments& arguments) {
  const std::wstring prefix = L"\\\\.\\pipe\\untypo-";
  const bool valid_pipe = arguments.pipe_name.starts_with(prefix) &&
                          arguments.pipe_name.size() <= 240;
  const bool valid_token =
      arguments.token.size() == 64 &&
      std::all_of(arguments.token.begin(), arguments.token.end(), [](char value) {
        return std::isxdigit(static_cast<unsigned char>(value)) != 0;
      });
  return valid_pipe && valid_token;
}

int RunSelfTest() {
  if (sizeof(untypo::FrameHeader) != 12 ||
      sizeof(untypo::HotkeyConfiguration) != 8 ||
      sizeof(untypo::HotkeyConfigurationResultPayload) != 4 ||
      sizeof(untypo::TargetSnapshotPayload) != 14 ||
      untypo::kProtocolVersion != 2) {
    return 1;
  }
  return 0;
}

}  // namespace

int WINAPI wWinMain(HINSTANCE instance, HINSTANCE, PWSTR, int) {
  SetDefaultDllDirectories(LOAD_LIBRARY_SEARCH_SYSTEM32 |
                           LOAD_LIBRARY_SEARCH_USER_DIRS);
  HeapSetInformation(nullptr, HeapEnableTerminationOnCorruption, nullptr, 0);

  const Arguments arguments = ParseArguments();
  if (arguments.self_test) return RunSelfTest();
  if (!ValidArguments(arguments)) return 2;

  MSG pending_message{};
  PeekMessageW(&pending_message, nullptr, WM_USER, WM_USER, PM_NOREMOVE);
  const DWORD main_thread_id = GetCurrentThreadId();
  untypo::WindowTargetService targets;
  untypo::PipeServer pipe;
  untypo::HotkeyMonitor hotkey;

  untypo::PipeCallbacks callbacks;
  callbacks.configure_hotkey = [&hotkey](
                                     const untypo::HotkeyConfiguration& value) {
    return hotkey.Configure(value);
  };
  callbacks.capture_target = [&targets] { return targets.Capture(); };
  callbacks.paste = [&targets](const untypo::PasteRequestPayload& request) {
    return targets.Paste(request);
  };
  callbacks.shutdown = [main_thread_id] {
    PostThreadMessageW(main_thread_id, WM_QUIT, 0, 0);
  };
  callbacks.disconnected = [main_thread_id] {
    PostThreadMessageW(main_thread_id, WM_QUIT, 0, 0);
  };

  if (!hotkey.Install(
          [&pipe](untypo::HotkeyAction action) { pipe.SendHotkey(action); },
          instance)) {
    return 4;
  }
  if (!pipe.Start(arguments.pipe_name, arguments.token, std::move(callbacks))) {
    hotkey.Uninstall();
    return 3;
  }

  MSG message{};
  while (GetMessageW(&message, nullptr, 0, 0) > 0) {
    TranslateMessage(&message);
    DispatchMessageW(&message);
  }

  hotkey.Uninstall();
  pipe.Stop();
  return 0;
}
