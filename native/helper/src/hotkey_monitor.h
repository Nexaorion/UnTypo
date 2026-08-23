#pragma once

#include <Windows.h>

#include <functional>
#include <mutex>

#include "protocol.h"

namespace untypo {

class HotkeyMonitor {
 public:
  using Callback = std::function<void(HotkeyAction)>;

  HotkeyMonitor();
  ~HotkeyMonitor();

  HotkeyMonitor(const HotkeyMonitor&) = delete;
  HotkeyMonitor& operator=(const HotkeyMonitor&) = delete;

  bool Install(Callback callback);
  void Configure(const HotkeyConfiguration& configuration);
  void Uninstall();

 private:
  static LRESULT CALLBACK HookProcedure(int code, WPARAM message, LPARAM data);
  LRESULT HandleKeyboardEvent(WPARAM message, const KBDLLHOOKSTRUCT& keyboard);
  bool ModifiersMatch(std::uint32_t modifiers) const;

  static HotkeyMonitor* instance_;
  Callback callback_;
  HotkeyConfiguration configuration_;
  HHOOK hook_ = nullptr;
  bool key_pressed_ = false;
  mutable std::mutex mutex_;
};

}
