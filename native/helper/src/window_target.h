#pragma once

#include <cstdint>
#include <vector>
#include <string>
#include <Windows.h>
#include <objbase.h>
#include <UIAutomation.h>
#include <wrl/client.h>

#include "protocol.h"

namespace untypo {

class WindowTargetService {
 public:
  std::vector<std::uint8_t> Capture() const;
  PasteResultPayload Paste(const PasteRequestPayload& request) const;
  std::vector<std::uint8_t> CaptureSelection();
  PasteResultPayload ReplaceSelection();
  void ClearSelection();

 private:
  Microsoft::WRL::ComPtr<IUIAutomationElement> selection_element_;
  Microsoft::WRL::ComPtr<IUIAutomationTextRange> selection_range_;
  std::wstring selection_text_;
  HWND selection_window_ = nullptr;
  DWORD selection_process_ = 0;
  bool selection_editable_ = false;
  bool IsEditable(void* window_handle) const;
  bool IsHigherIntegrity(std::uint32_t process_id) const;
};

}
