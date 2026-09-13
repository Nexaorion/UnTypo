#pragma once

#include <Carbon/Carbon.h>

#include <functional>
#include <string>

#include "../protocol.h"

namespace untypo {

class HotkeyMonitor {
 public:
  using Callback = std::function<void(HotkeyAction)>;

  HotkeyMonitor();
  ~HotkeyMonitor();

  HotkeyMonitor(const HotkeyMonitor&) = delete;
  HotkeyMonitor& operator=(const HotkeyMonitor&) = delete;

  bool Install(Callback callback);
  HotkeyConfigurationResultPayload Configure(
      const HotkeyConfiguration& configuration);
  void Uninstall();

 private:
  static constexpr UInt32 kFirstHotkeyId = 1;
  static constexpr UInt32 kSecondHotkeyId = 2;
  static constexpr OSType kHotkeySignature = 'UTYP';

  static OSStatus HandleHotkeyEvent(EventHandlerCallRef handler,
                                    EventRef event, void* user_data);
  HotkeyConfigurationResultPayload ConfigureOnMainThread(
      const HotkeyConfiguration& configuration);
  void EmitToggle();

  Callback callback_;
  HotkeyConfiguration configuration_{};
  EventHandlerRef handler_ref_ = nullptr;
  EventHotKeyRef hotkey_ref_ = nullptr;
  UInt32 registered_hotkey_id_ = 0;
  int lock_fd_ = -1;
  std::string lock_path_;
  bool installed_ = false;
};

}  // namespace untypo
