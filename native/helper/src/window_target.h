#pragma once

#include <cstdint>
#include <vector>

#include "protocol.h"

namespace untypo {

class WindowTargetService {
 public:
  std::vector<std::uint8_t> Capture() const;
  PasteResultPayload Paste(const PasteRequestPayload& request) const;

 private:
  bool IsEditable(void* window_handle) const;
  bool IsHigherIntegrity(std::uint32_t process_id) const;
};

}
