#include "hotkey_monitor.h"

#include <utility>

namespace untypo {

HotkeyMonitor* HotkeyMonitor::instance_ = nullptr;

HotkeyMonitor::HotkeyMonitor()
    : configuration_{VK_F9, 0, HotkeyMode::PushToTalk} {}

HotkeyMonitor::~HotkeyMonitor() { Uninstall(); }

bool HotkeyMonitor::Install(Callback callback) {
  if (hook_ != nullptr || instance_ != nullptr) {
    return false;
  }
  callback_ = std::move(callback);
  instance_ = this;
  hook_ = SetWindowsHookExW(WH_KEYBOARD_LL, HookProcedure, GetModuleHandleW(nullptr), 0);
  if (hook_ == nullptr) {
    instance_ = nullptr;
    callback_ = nullptr;
    return false;
  }
  return true;
}

void HotkeyMonitor::Configure(const HotkeyConfiguration& configuration) {
  std::scoped_lock lock(mutex_);
  configuration_ = configuration;
  key_pressed_ = false;
}

void HotkeyMonitor::Uninstall() {
  if (hook_ != nullptr) {
    UnhookWindowsHookEx(hook_);
    hook_ = nullptr;
  }
  if (instance_ == this) {
    instance_ = nullptr;
  }
  callback_ = nullptr;
}

LRESULT CALLBACK HotkeyMonitor::HookProcedure(int code, WPARAM message, LPARAM data) {
  if (code == HC_ACTION && instance_ != nullptr && data != 0) {
    const auto* keyboard = reinterpret_cast<const KBDLLHOOKSTRUCT*>(data);
    instance_->HandleKeyboardEvent(message, *keyboard);
  }
  return CallNextHookEx(nullptr, code, message, data);
}

LRESULT HotkeyMonitor::HandleKeyboardEvent(WPARAM message,
                                           const KBDLLHOOKSTRUCT& keyboard) {
  if ((keyboard.flags & LLKHF_INJECTED) != 0) {
    return 0;
  }

  Callback callback;
  HotkeyAction action{};
  bool notify = false;
  {
    std::scoped_lock lock(mutex_);
    if (keyboard.vkCode != configuration_.virtual_key) {
      return 0;
    }

    const bool key_down = message == WM_KEYDOWN || message == WM_SYSKEYDOWN;
    const bool key_up = message == WM_KEYUP || message == WM_SYSKEYUP;
    if (key_down && !key_pressed_ && ModifiersMatch(configuration_.modifiers)) {
      key_pressed_ = true;
      action = configuration_.mode == HotkeyMode::Toggle ? HotkeyAction::Toggle
                                                         : HotkeyAction::Start;
      notify = true;
    } else if (key_up && key_pressed_) {
      key_pressed_ = false;
      if (configuration_.mode == HotkeyMode::PushToTalk) {
        action = HotkeyAction::Stop;
        notify = true;
      }
    }
    callback = callback_;
  }

  if (notify && callback) {
    callback(action);
  }
  return 0;
}

bool HotkeyMonitor::ModifiersMatch(std::uint32_t modifiers) const {
  const auto down = [](int key) { return (GetAsyncKeyState(key) & 0x8000) != 0; };
  if ((modifiers & MOD_CONTROL) != 0 && !down(VK_CONTROL)) return false;
  if ((modifiers & MOD_ALT) != 0 && !down(VK_MENU)) return false;
  if ((modifiers & MOD_SHIFT) != 0 && !down(VK_SHIFT)) return false;
  if ((modifiers & MOD_WIN) != 0 && !down(VK_LWIN) && !down(VK_RWIN)) return false;
  return true;
}

}
