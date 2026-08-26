#include "hotkey_monitor.h"

#include <utility>

namespace untypo {

namespace {

constexpr wchar_t kWindowClassName[] = L"UnTypoHotkeyWindow";

}

HotkeyMonitor::HotkeyMonitor() : configuration_{VK_F9, 0} {}

HotkeyMonitor::~HotkeyMonitor() { Uninstall(); }

bool HotkeyMonitor::Install(Callback callback, HINSTANCE instance) {
  if (window_ != nullptr || owner_thread_id_ != 0) return false;

  WNDCLASSEXW window_class{};
  window_class.cbSize = sizeof(window_class);
  window_class.lpfnWndProc = WindowProcedure;
  window_class.hInstance = instance;
  window_class.lpszClassName = kWindowClassName;
  if (RegisterClassExW(&window_class) == 0 &&
      GetLastError() != ERROR_CLASS_ALREADY_EXISTS) {
    return false;
  }

  callback_ = std::move(callback);
  owner_thread_id_ = GetCurrentThreadId();
  window_ = CreateWindowExW(0, kWindowClassName, L"", 0, 0, 0, 0, 0,
                            HWND_MESSAGE, nullptr, instance, this);
  if (window_ == nullptr) {
    owner_thread_id_ = 0;
    callback_ = nullptr;
    return false;
  }
  return true;
}

HotkeyConfigurationResultPayload HotkeyMonitor::Configure(
    const HotkeyConfiguration& configuration) {
  if (window_ == nullptr || owner_thread_id_ == 0) {
    return {ERROR_INVALID_WINDOW_HANDLE};
  }
  if (GetCurrentThreadId() == owner_thread_id_) {
    return ConfigureOnOwnerThread(configuration);
  }

  ConfigureRequest request{configuration, {ERROR_GEN_FAILURE}};
  SendMessageW(window_, kConfigureMessage, 0,
               reinterpret_cast<LPARAM>(&request));
  return request.result;
}

void HotkeyMonitor::Uninstall() {
  if (window_ == nullptr) return;
  if (GetCurrentThreadId() != owner_thread_id_) {
    SendMessageW(window_, WM_CLOSE, 0, 0);
    return;
  }
  if (registered_hotkey_id_ != 0) {
    UnregisterHotKey(window_, registered_hotkey_id_);
    registered_hotkey_id_ = 0;
  }
  DestroyWindow(window_);
  window_ = nullptr;
  owner_thread_id_ = 0;
  callback_ = nullptr;
}

LRESULT CALLBACK HotkeyMonitor::WindowProcedure(HWND window, UINT message,
                                                 WPARAM wparam,
                                                 LPARAM lparam) {
  HotkeyMonitor* monitor = reinterpret_cast<HotkeyMonitor*>(
      GetWindowLongPtrW(window, GWLP_USERDATA));
  if (message == WM_NCCREATE) {
    const auto* create = reinterpret_cast<const CREATESTRUCTW*>(lparam);
    monitor = static_cast<HotkeyMonitor*>(create->lpCreateParams);
    SetWindowLongPtrW(window, GWLP_USERDATA,
                      reinterpret_cast<LONG_PTR>(monitor));
  }
  if (monitor != nullptr) {
    return monitor->HandleWindowMessage(window, message, wparam, lparam);
  }
  return DefWindowProcW(window, message, wparam, lparam);
}

HotkeyConfigurationResultPayload HotkeyMonitor::ConfigureOnOwnerThread(
    const HotkeyConfiguration& configuration) {
  if (registered_hotkey_id_ != 0 &&
      configuration.virtual_key == configuration_.virtual_key &&
      configuration.modifiers == configuration_.modifiers) {
    return {ERROR_SUCCESS};
  }

  const int candidate_id = registered_hotkey_id_ == kFirstHotkeyId
                               ? kSecondHotkeyId
                               : kFirstHotkeyId;
  if (!RegisterHotKey(window_, candidate_id,
                      configuration.modifiers | MOD_NOREPEAT,
                      configuration.virtual_key)) {
    return {GetLastError()};
  }

  if (registered_hotkey_id_ != 0) {
    UnregisterHotKey(window_, registered_hotkey_id_);
  }
  registered_hotkey_id_ = candidate_id;
  configuration_ = configuration;
  return {ERROR_SUCCESS};
}

LRESULT HotkeyMonitor::HandleWindowMessage(HWND window, UINT message,
                                            WPARAM wparam, LPARAM lparam) {
  if (message == kConfigureMessage) {
    auto* request = reinterpret_cast<ConfigureRequest*>(lparam);
    if (request != nullptr) {
      request->result = ConfigureOnOwnerThread(request->configuration);
    }
    return 0;
  }
  if (message == WM_HOTKEY &&
      static_cast<int>(wparam) == registered_hotkey_id_) {
    if (callback_) callback_(HotkeyAction::Toggle);
    return 0;
  }
  return DefWindowProcW(window, message, wparam, lparam);
}

}  // namespace untypo
