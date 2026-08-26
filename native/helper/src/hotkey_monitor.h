#pragma once

#include <Windows.h>

#include <functional>

#include "protocol.h"

namespace untypo {

class HotkeyMonitor {
 public:
  using Callback = std::function<void(HotkeyAction)>;

  HotkeyMonitor();
  ~HotkeyMonitor();

  HotkeyMonitor(const HotkeyMonitor&) = delete;
  HotkeyMonitor& operator=(const HotkeyMonitor&) = delete;

  bool Install(Callback callback, HINSTANCE instance);
  HotkeyConfigurationResultPayload Configure(
      const HotkeyConfiguration& configuration);
  void Uninstall();

 private:
  struct ConfigureRequest {
    HotkeyConfiguration configuration;
    HotkeyConfigurationResultPayload result;
  };

  static constexpr int kFirstHotkeyId = 1;
  static constexpr int kSecondHotkeyId = 2;
  static constexpr UINT kConfigureMessage = WM_APP + 1;

  static LRESULT CALLBACK WindowProcedure(HWND window, UINT message,
                                          WPARAM wparam, LPARAM lparam);
  HotkeyConfigurationResultPayload ConfigureOnOwnerThread(
      const HotkeyConfiguration& configuration);
  LRESULT HandleWindowMessage(HWND window, UINT message, WPARAM wparam,
                              LPARAM lparam);

  Callback callback_;
  HotkeyConfiguration configuration_;
  DWORD owner_thread_id_ = 0;
  HWND window_ = nullptr;
  int registered_hotkey_id_ = 0;
};

}
