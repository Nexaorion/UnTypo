#pragma once

#include <cstdint>
#include <string>
#include <sys/types.h>
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

 private:
  std::u16string selection_text_;
  std::uint64_t selection_window_handle_ = 0;
  std::uint32_t selection_process_ = 0;
  bool selection_editable_ = false;

  bool IsTrusted() const;
  bool IsEditable(pid_t process_id) const;
  bool ModifierHeld() const;
};

}  // namespace untypo
