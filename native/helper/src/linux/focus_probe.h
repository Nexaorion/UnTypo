#pragma once

#include <cstdint>

namespace untypo {
enum class LinuxEditability : std::uint8_t {
  Unknown = 0,
  Editable = 1,
  NotEditable = 2,
};

LinuxEditability ProbeFocusedEditability(std::uint32_t process_id);
}  // namespace untypo
