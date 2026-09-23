#pragma once

#include <functional>
#include "../protocol.h"

namespace untypo {
class HotkeyMonitor {
 public:
  using Callback = std::function<void(HotkeyAction)>;
  bool Install(Callback callback);
  HotkeyConfigurationResultPayload Configure(const HotkeyConfiguration& configuration);
  void Uninstall();
 private:
  Callback callback_;
};
}  // namespace untypo
