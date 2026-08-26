#include "window_target.h"

#include <Windows.h>
#include <objbase.h>
#include <UIAutomation.h>
#include <wrl/client.h>
#include <Psapi.h>

#include <cstdint>
#include <string>
#include <vector>

namespace untypo {

namespace {

using Microsoft::WRL::ComPtr;

DWORD IntegrityLevelForProcess(DWORD process_id) {
  const HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, process_id);
  if (process == nullptr) return 0;

  HANDLE token = nullptr;
  if (!OpenProcessToken(process, TOKEN_QUERY, &token)) {
    CloseHandle(process);
    return 0;
  }

  DWORD required = 0;
  GetTokenInformation(token, TokenIntegrityLevel, nullptr, 0, &required);
  if (required == 0) {
    CloseHandle(token);
    CloseHandle(process);
    return 0;
  }

  auto* buffer = new std::uint8_t[required];
  DWORD level = 0;
  if (GetTokenInformation(token, TokenIntegrityLevel, buffer, required, &required)) {
    const auto* label = reinterpret_cast<const TOKEN_MANDATORY_LABEL*>(buffer);
    const DWORD count = *GetSidSubAuthorityCount(label->Label.Sid);
    level = *GetSidSubAuthority(label->Label.Sid, count - 1);
  }
  delete[] buffer;
  CloseHandle(token);
  CloseHandle(process);
  return level;
}

std::wstring GetWindowTitle(HWND window) {
  if (window == nullptr) return L"";
  const int length = GetWindowTextLengthW(window);
  if (length <= 0) return L"";
  std::vector<wchar_t> buffer(length + 1);
  const int result = GetWindowTextW(window, buffer.data(), length + 1);
  if (result <= 0) return L"";
  return std::wstring(buffer.data(), result);
}

std::wstring GetProcessName(DWORD process_id) {
  if (process_id == 0) return L"";
  const HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, process_id);
  if (process == nullptr) return L"";

  std::vector<wchar_t> buffer(MAX_PATH);
  DWORD size = static_cast<DWORD>(buffer.size());
  if (QueryFullProcessImageNameW(process, 0, buffer.data(), &size) && size > 0) {
    std::wstring full_path(buffer.data(), size);
    const size_t last_slash = full_path.find_last_of(L"\\/");
    CloseHandle(process);
    if (last_slash != std::wstring::npos) {
      return full_path.substr(last_slash + 1);
    }
    return full_path;
  }
  CloseHandle(process);
  return L"";
}

std::vector<std::uint8_t> EncodeTargetSnapshot(
    std::uint64_t window_handle,
    std::uint32_t process_id,
    std::uint8_t editable,
    std::uint8_t higher_integrity,
    const std::wstring& window_title,
    const std::wstring& process_name) {
  std::vector<std::uint8_t> payload;
  payload.resize(14);

  *reinterpret_cast<std::uint64_t*>(&payload[0]) = window_handle;
  *reinterpret_cast<std::uint32_t*>(&payload[8]) = process_id;
  payload[12] = editable;
  payload[13] = higher_integrity;

  // Add window title length and content
  const std::uint16_t title_length = static_cast<std::uint16_t>(window_title.length());
  payload.push_back(title_length & 0xFF);
  payload.push_back((title_length >> 8) & 0xFF);
  const auto* title_bytes = reinterpret_cast<const std::uint8_t*>(window_title.c_str());
  payload.insert(payload.end(), title_bytes, title_bytes + title_length * sizeof(wchar_t));

  // Add process name length and content
  const std::uint16_t name_length = static_cast<std::uint16_t>(process_name.length());
  payload.push_back(name_length & 0xFF);
  payload.push_back((name_length >> 8) & 0xFF);
  const auto* name_bytes = reinterpret_cast<const std::uint8_t*>(process_name.c_str());
  payload.insert(payload.end(), name_bytes, name_bytes + name_length * sizeof(wchar_t));

  return payload;
}

}

TargetSnapshotPayload WindowTargetService::Capture() const {
  const HWND window = GetForegroundWindow();
  DWORD process_id = 0;
  if (window != nullptr) {
    GetWindowThreadProcessId(window, &process_id);
  }

  const std::wstring window_title = GetWindowTitle(window);
  const std::wstring process_name = GetProcessName(process_id);

  return {
      reinterpret_cast<std::uint64_t>(window),
      process_id,
      static_cast<std::uint8_t>(window != nullptr && IsEditable(window)),
      static_cast<std::uint8_t>(process_id != 0 && IsHigherIntegrity(process_id)),
  };
}

PasteResultPayload WindowTargetService::Paste(
    const PasteRequestPayload& request) const {
  const auto expected = reinterpret_cast<HWND>(request.window_handle);
  const HWND foreground = GetForegroundWindow();
  DWORD process_id = 0;
  if (foreground != nullptr) {
    GetWindowThreadProcessId(foreground, &process_id);
  }
  if (foreground != expected || process_id != request.process_id) {
    return {PasteStatus::TargetChanged};
  }
  if (IsHigherIntegrity(process_id)) {
    return {PasteStatus::HigherIntegrity};
  }
  if (!IsEditable(foreground)) {
    return {PasteStatus::NotEditable};
  }

  INPUT input[4]{};
  input[0].type = INPUT_KEYBOARD;
  input[0].ki.wVk = VK_CONTROL;
  input[1].type = INPUT_KEYBOARD;
  input[1].ki.wVk = 'V';
  input[2].type = INPUT_KEYBOARD;
  input[2].ki.wVk = 'V';
  input[2].ki.dwFlags = KEYEVENTF_KEYUP;
  input[3].type = INPUT_KEYBOARD;
  input[3].ki.wVk = VK_CONTROL;
  input[3].ki.dwFlags = KEYEVENTF_KEYUP;
  const UINT sent = SendInput(4, input, sizeof(INPUT));
  return {sent == 4 ? PasteStatus::Success : PasteStatus::SendInputFailed};
}

bool WindowTargetService::IsEditable(void* window_handle) const {
  const auto target_window = static_cast<HWND>(window_handle);
  ComPtr<IUIAutomation> automation;
  if (FAILED(CoCreateInstance(CLSID_CUIAutomation, nullptr, CLSCTX_INPROC_SERVER,
                              IID_PPV_ARGS(&automation)))) {
    return false;
  }

  ComPtr<IUIAutomationElement> focused;
  if (FAILED(automation->GetFocusedElement(&focused)) || !focused) {
    return false;
  }

  BOOL enabled = FALSE;
  BOOL has_focus = FALSE;
  CONTROLTYPEID control_type = 0;
  focused->get_CurrentIsEnabled(&enabled);
  focused->get_CurrentHasKeyboardFocus(&has_focus);
  focused->get_CurrentControlType(&control_type);
  if (!enabled || !has_focus) {
    return false;
  }

  UIA_HWND native_handle = nullptr;
  if (SUCCEEDED(focused->get_CurrentNativeWindowHandle(&native_handle)) &&
      native_handle != nullptr) {
    const HWND root = GetAncestor(reinterpret_cast<HWND>(native_handle), GA_ROOT);
    if (root != nullptr && root != target_window) {
      return false;
    }
  }

  ComPtr<IUIAutomationValuePattern> value_pattern;
  if (SUCCEEDED(focused->GetCurrentPatternAs(UIA_ValuePatternId,
                                             IID_PPV_ARGS(&value_pattern))) &&
      value_pattern) {
    BOOL read_only = TRUE;
    if (SUCCEEDED(value_pattern->get_CurrentIsReadOnly(&read_only)) && !read_only) {
      return true;
    }
  }

  ComPtr<IUIAutomationTextPattern> text_pattern;
  return control_type == UIA_EditControlTypeId &&
         SUCCEEDED(focused->GetCurrentPatternAs(UIA_TextPatternId,
                                                IID_PPV_ARGS(&text_pattern))) &&
         text_pattern;
}

bool WindowTargetService::IsHigherIntegrity(std::uint32_t process_id) const {
  const DWORD current_level = IntegrityLevelForProcess(GetCurrentProcessId());
  const DWORD target_level = IntegrityLevelForProcess(process_id);
  if (current_level == 0 || target_level == 0) {
    return true;
  }
  return target_level > current_level;
}

}
