#include "hotkey_monitor.h"
#include <utility>

namespace untypo {
bool HotkeyMonitor::Install(Callback callback) {
  callback_ = std::move(callback);
  return true;
}

HotkeyConfigurationResultPayload HotkeyMonitor::Configure(
    const HotkeyConfiguration& configuration) {
  if (configuration.virtual_key == 0 || configuration.virtual_key > 0xff ||
      (configuration.modifiers & ~0x0fu) != 0) return {87};
  return {0};
}

void HotkeyMonitor::Uninstall() { callback_ = nullptr; }
}  // namespace untypo
