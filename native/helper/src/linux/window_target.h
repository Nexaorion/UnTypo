#pragma once

#include <cstdint>
#include <vector>
#include "../protocol.h"

namespace untypo {
class WindowTargetService {
 public:
  std::vector<std::uint8_t> Capture() const;
  PasteResultPayload Paste(const PasteRequestPayload& request) const;
  std::vector<std::uint8_t> CaptureSelection();
  PasteResultPayload ReplaceSelection();
  void ClearSelection();
};
}  // namespace untypo
