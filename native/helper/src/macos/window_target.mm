#include "window_target.h"

#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
#import <Carbon/Carbon.h>
#import <Foundation/Foundation.h>

#include <unistd.h>

#include <algorithm>
#include <cstring>
#include <memory>

namespace untypo {

namespace {

constexpr std::uint32_t kMaximumSelectionCharacters = 20'000;

struct CfReleaser {
  void operator()(CFTypeRef value) const {
    if (value != nullptr) CFRelease(value);
  }
};

std::u16string Utf16FromNs(NSString* value) {
  if (value == nil || value.length == 0) return {};
  NSData* data = [value dataUsingEncoding:NSUTF16LittleEndianStringEncoding];
  if (data == nil || data.length == 0) return {};
  const auto count = static_cast<std::size_t>(data.length / 2);
  const auto* units = static_cast<const char16_t*>(data.bytes);
  return std::u16string(units, count);
}

std::u16string Truncate(const std::u16string& value) {
  if (value.size() <= kMaximumTargetContextCharacters) return value;
  return value.substr(0, kMaximumTargetContextCharacters);
}

std::uint64_t EncodeHandle(std::uint32_t process_id, std::uint32_t window_id) {
  return (static_cast<std::uint64_t>(process_id) << 32) | window_id;
}

void AppendUtf16(std::vector<std::uint8_t>& payload, const std::u16string& value) {
  const auto truncated = Truncate(value);
  const auto length = static_cast<std::uint16_t>(truncated.size());
  payload.push_back(static_cast<std::uint8_t>(length & 0xff));
  payload.push_back(static_cast<std::uint8_t>((length >> 8) & 0xff));
  if (length == 0) return;
  const auto* bytes = reinterpret_cast<const std::uint8_t*>(truncated.data());
  payload.insert(payload.end(), bytes, bytes + length * 2);
}

std::vector<std::uint8_t> EncodeTargetSnapshot(
    std::uint64_t window_handle, std::uint32_t process_id, bool editable,
    bool higher_integrity, const std::u16string& window_title,
    const std::u16string& process_name) {
  const TargetSnapshotHeader header{
      window_handle, process_id,
      static_cast<std::uint8_t>(editable ? 1 : 0),
      static_cast<std::uint8_t>(higher_integrity ? 1 : 0)};
  std::vector<std::uint8_t> payload(sizeof(header));
  std::memcpy(payload.data(), &header, sizeof(header));
  AppendUtf16(payload, window_title);
  AppendUtf16(payload, process_name);
  return payload;
}

bool IsOwnProcess(pid_t process_id) {
  return process_id == getpid() || process_id == getppid();
}

NSRunningApplication* FrontmostApp() {
  NSRunningApplication* front =
      [[NSWorkspace sharedWorkspace] frontmostApplication];
  if (front != nil && !IsOwnProcess(front.processIdentifier)) return front;

  CFArrayRef raw_list = CGWindowListCopyWindowInfo(
      kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements,
      kCGNullWindowID);
  if (raw_list == nullptr) return front;
  std::unique_ptr<const void, CfReleaser> list(raw_list);
  const auto count = CFArrayGetCount(raw_list);
  for (CFIndex index = 0; index < count; ++index) {
    const auto* info = static_cast<CFDictionaryRef>(CFArrayGetValueAtIndex(
        raw_list, index));
    if (info == nullptr) continue;
    const auto* pid_value = static_cast<CFNumberRef>(
        CFDictionaryGetValue(info, kCGWindowOwnerPID));
    const auto* layer_value = static_cast<CFNumberRef>(
        CFDictionaryGetValue(info, kCGWindowLayer));
    std::int32_t pid = 0;
    std::int32_t layer = 0;
    if (pid_value == nullptr || layer_value == nullptr) continue;
    CFNumberGetValue(pid_value, kCFNumberSInt32Type, &pid);
    CFNumberGetValue(layer_value, kCFNumberSInt32Type, &layer);
    if (layer != 0 || IsOwnProcess(static_cast<pid_t>(pid))) continue;
    NSRunningApplication* candidate = [NSRunningApplication
        runningApplicationWithProcessIdentifier:static_cast<pid_t>(pid)];
    if (candidate != nil) return candidate;
  }
  return front;
}

std::uint32_t FrontmostWindowId(std::uint32_t process_id) {
  CFArrayRef raw_list = CGWindowListCopyWindowInfo(
      kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements,
      kCGNullWindowID);
  if (raw_list == nullptr) return 0;
  std::unique_ptr<const void, CfReleaser> list(raw_list);
  const auto count = CFArrayGetCount(raw_list);
  for (CFIndex index = 0; index < count; ++index) {
    const auto* info = static_cast<CFDictionaryRef>(CFArrayGetValueAtIndex(
        raw_list, index));
    if (info == nullptr) continue;
    const auto* pid_value = static_cast<CFNumberRef>(
        CFDictionaryGetValue(info, kCGWindowOwnerPID));
    const auto* layer_value = static_cast<CFNumberRef>(
        CFDictionaryGetValue(info, kCGWindowLayer));
    const auto* number_value = static_cast<CFNumberRef>(
        CFDictionaryGetValue(info, kCGWindowNumber));
    std::int32_t pid = 0;
    std::int32_t layer = 0;
    std::uint32_t window_id = 0;
    if (pid_value == nullptr || layer_value == nullptr ||
        number_value == nullptr) {
      continue;
    }
    CFNumberGetValue(pid_value, kCFNumberSInt32Type, &pid);
    CFNumberGetValue(layer_value, kCFNumberSInt32Type, &layer);
    CFNumberGetValue(number_value, kCFNumberIntType, &window_id);
    if (layer == 0 && static_cast<std::uint32_t>(pid) == process_id) {
      return window_id;
    }
  }
  return 0;
}

std::u16string WindowTitle(std::uint32_t process_id) {
  AXUIElementRef application = AXUIElementCreateApplication(
      static_cast<pid_t>(process_id));
  if (application == nullptr) return {};
  std::unique_ptr<const void, CfReleaser> app_owner(application);
  CFTypeRef window_ref = nullptr;
  if (AXUIElementCopyAttributeValue(application, kAXFocusedWindowAttribute,
                                    &window_ref) != kAXErrorSuccess ||
      window_ref == nullptr) {
    return {};
  }
  std::unique_ptr<const void, CfReleaser> window_owner(window_ref);
  CFTypeRef title_ref = nullptr;
  if (AXUIElementCopyAttributeValue(static_cast<AXUIElementRef>(window_ref),
                                    kAXTitleAttribute,
                                    &title_ref) != kAXErrorSuccess ||
      title_ref == nullptr) {
    return {};
  }
  std::unique_ptr<const void, CfReleaser> title_owner(title_ref);
  if (CFGetTypeID(title_ref) != CFStringGetTypeID()) return {};
  return Utf16FromNs((__bridge NSString*)title_ref);
}

std::u16string ProcessName(NSRunningApplication* application) {
  if (application == nil) return {};
  NSString* name = application.executableURL.lastPathComponent;
  if (name.length == 0) name = application.localizedName;
  return Utf16FromNs(name);
}

bool RoleIsSecure(CFStringRef role) {
  return role != nullptr && CFEqual(role, CFSTR("AXSecureTextField"));
}

bool RoleLooksEditable(CFStringRef role) {
  if (role == nullptr) return false;
  return CFEqual(role, kAXTextFieldRole) || CFEqual(role, kAXTextAreaRole) ||
         CFEqual(role, kAXComboBoxRole) ||
         CFEqual(role, CFSTR("AXSearchField")) ||
         CFEqual(role, CFSTR("AXText")) || CFEqual(role, CFSTR("AXTextView"));
}

bool AttributeExists(AXUIElementRef element, CFStringRef name) {
  CFTypeRef value = nullptr;
  const AXError error = AXUIElementCopyAttributeValue(element, name, &value);
  if (value != nullptr) CFRelease(value);
  return error == kAXErrorSuccess;
}

AXUIElementRef CopyFocusedElement() {
  AXUIElementRef system_wide = AXUIElementCreateSystemWide();
  if (system_wide == nullptr) return nullptr;
  std::unique_ptr<const void, CfReleaser> system_owner(system_wide);
  CFTypeRef focused = nullptr;
  if (AXUIElementCopyAttributeValue(system_wide, kAXFocusedUIElementAttribute,
                                    &focused) != kAXErrorSuccess) {
    return nullptr;
  }
  return static_cast<AXUIElementRef>(focused);
}

AXUIElementRef CopyFocusedElementForProcess(pid_t process_id) {
  AXUIElementRef application = AXUIElementCreateApplication(process_id);
  if (application == nullptr) return nullptr;
  std::unique_ptr<const void, CfReleaser> app_owner(application);
  CFTypeRef focused = nullptr;
  if (AXUIElementCopyAttributeValue(application, kAXFocusedUIElementAttribute,
                                    &focused) != kAXErrorSuccess) {
    return nullptr;
  }
  return static_cast<AXUIElementRef>(focused);
}

bool ElementIsEnabled(AXUIElementRef element) {
  CFTypeRef enabled_ref = nullptr;
  if (AXUIElementCopyAttributeValue(element, kAXEnabledAttribute,
                                    &enabled_ref) != kAXErrorSuccess ||
      enabled_ref == nullptr) {
    return true;
  }
  std::unique_ptr<const void, CfReleaser> enabled_owner(enabled_ref);
  return CFGetTypeID(enabled_ref) == CFBooleanGetTypeID() &&
         CFBooleanGetValue(static_cast<CFBooleanRef>(enabled_ref));
}

bool ElementIsEditable(AXUIElementRef focused) {
  if (focused == nullptr || !ElementIsEnabled(focused)) return false;
  CFTypeRef role_ref = nullptr;
  if (AXUIElementCopyAttributeValue(focused, kAXRoleAttribute, &role_ref) !=
          kAXErrorSuccess ||
      role_ref == nullptr) {
    return false;
  }
  std::unique_ptr<const void, CfReleaser> role_owner(role_ref);
  if (CFGetTypeID(role_ref) != CFStringGetTypeID()) return false;
  const auto role = static_cast<CFStringRef>(role_ref);
  if (RoleIsSecure(role)) return false;

  Boolean value_settable = false;
  AXUIElementIsAttributeSettable(focused, kAXValueAttribute, &value_settable);
  Boolean selected_settable = false;
  AXUIElementIsAttributeSettable(focused, kAXSelectedTextAttribute,
                                 &selected_settable);
  return RoleLooksEditable(role) || value_settable || selected_settable ||
         AttributeExists(focused, kAXSelectedTextAttribute) ||
         AttributeExists(focused, kAXSelectedTextRangeAttribute);
}

bool ActivateProcess(pid_t pid) {
  NSRunningApplication* application =
      [NSRunningApplication runningApplicationWithProcessIdentifier:pid];
  if (application == nil) return false;
  return [application activateWithOptions:NSApplicationActivateIgnoringOtherApps];
}

bool InsertClipboardViaAx(AXUIElementRef focused) {
  NSString* text =
      [[NSPasteboard generalPasteboard] stringForType:NSPasteboardTypeString];
  if (text.length == 0 || focused == nullptr) return false;
  const AXError error = AXUIElementSetAttributeValue(
      focused, kAXSelectedTextAttribute, (__bridge CFTypeRef)text);
  return error == kAXErrorSuccess;
}

std::vector<std::uint8_t> EmptySelection() { return std::vector<std::uint8_t>(5, 0); }

}  // namespace

bool WindowTargetService::IsTrusted() const { return AXIsProcessTrusted(); }

bool WindowTargetService::IsEditable() const {
  if (!IsTrusted()) return false;
  NSRunningApplication* application = FrontmostApp();
  if (application == nil) return false;
  AXUIElementRef focused =
      CopyFocusedElementForProcess(application.processIdentifier);
  if (focused == nullptr) return false;
  std::unique_ptr<const void, CfReleaser> focused_owner(focused);
  return ElementIsEditable(focused);
}

bool WindowTargetService::ModifierHeld() const {
  const CGEventSourceStateID state = kCGEventSourceStateHIDSystemState;
  return CGEventSourceKeyState(state, kVK_Command) ||
         CGEventSourceKeyState(state, kVK_RightCommand) ||
         CGEventSourceKeyState(state, kVK_Shift) ||
         CGEventSourceKeyState(state, kVK_RightShift) ||
         CGEventSourceKeyState(state, kVK_Option) ||
         CGEventSourceKeyState(state, kVK_RightOption) ||
         CGEventSourceKeyState(state, kVK_Control) ||
         CGEventSourceKeyState(state, kVK_RightControl);
}

std::vector<std::uint8_t> WindowTargetService::Capture() const {
  NSRunningApplication* application = FrontmostApp();
  const std::uint32_t process_id =
      application == nil ? 0 : static_cast<std::uint32_t>(application.processIdentifier);
  const std::uint32_t window_id =
      process_id == 0 ? 0 : FrontmostWindowId(process_id);
  const bool trusted = IsTrusted();
  const bool editable = trusted && process_id != 0 && IsEditable();
  return EncodeTargetSnapshot(
      EncodeHandle(process_id, window_id), process_id, editable, !trusted,
      trusted ? WindowTitle(process_id) : std::u16string{},
      ProcessName(application));
}

PasteResultPayload WindowTargetService::Paste(
    const PasteRequestPayload& request) const {
  const auto process_id = static_cast<pid_t>(request.process_id);
  if (process_id <= 0 || IsOwnProcess(process_id)) {
    return {PasteStatus::TargetChanged};
  }
  NSRunningApplication* front =
      [[NSWorkspace sharedWorkspace] frontmostApplication];
  const pid_t front_pid =
      front == nil ? 0 : front.processIdentifier;
  if (front_pid != process_id && !IsOwnProcess(front_pid)) {
    return {PasteStatus::TargetChanged};
  }
  if (front_pid != process_id) {
    if (!ActivateProcess(process_id)) return {PasteStatus::TargetChanged};
    usleep(120'000);
  }
  if (!IsTrusted()) return {PasteStatus::HigherIntegrity};
  AXUIElementRef focused = CopyFocusedElementForProcess(process_id);
  if (focused == nullptr) return {PasteStatus::NotEditable};
  std::unique_ptr<const void, CfReleaser> focused_owner(focused);
  if (!ElementIsEditable(focused)) return {PasteStatus::NotEditable};
  if (InsertClipboardViaAx(focused)) return {PasteStatus::Success};
  return {PasteStatus::SendInputFailed};
}

void WindowTargetService::ClearSelection() {
  selection_text_.clear();
  selection_window_handle_ = 0;
  selection_process_ = 0;
  selection_editable_ = false;
}

std::vector<std::uint8_t> WindowTargetService::CaptureSelection() {
  ClearSelection();
  if (!IsTrusted()) return EmptySelection();
  NSRunningApplication* application = FrontmostApp();
  if (application == nil) return EmptySelection();
  const auto process_id =
      static_cast<std::uint32_t>(application.processIdentifier);
  const auto window_id = FrontmostWindowId(process_id);
  AXUIElementRef focused = CopyFocusedElement();
  if (focused == nullptr) return EmptySelection();
  std::unique_ptr<const void, CfReleaser> focused_owner(focused);

  CFTypeRef role_ref = nullptr;
  if (AXUIElementCopyAttributeValue(focused, kAXRoleAttribute, &role_ref) ==
          kAXErrorSuccess &&
      role_ref != nullptr) {
    std::unique_ptr<const void, CfReleaser> role_owner(role_ref);
    if (CFGetTypeID(role_ref) == CFStringGetTypeID() &&
        RoleIsSecure(static_cast<CFStringRef>(role_ref))) {
      return EmptySelection();
    }
  }

  CFTypeRef text_ref = nullptr;
  if (AXUIElementCopyAttributeValue(focused, kAXSelectedTextAttribute,
                                    &text_ref) != kAXErrorSuccess ||
      text_ref == nullptr) {
    return EmptySelection();
  }
  std::unique_ptr<const void, CfReleaser> text_owner(text_ref);
  if (CFGetTypeID(text_ref) != CFStringGetTypeID()) return EmptySelection();
  const std::u16string text = Utf16FromNs((__bridge NSString*)text_ref);
  if (text.empty() || text.size() > kMaximumSelectionCharacters) {
    return EmptySelection();
  }

  const bool editable = IsEditable();
  selection_text_ = text;
  selection_window_handle_ = EncodeHandle(process_id, window_id);
  selection_process_ = process_id;
  selection_editable_ = editable;

  std::vector<std::uint8_t> result(5 + text.size() * 2);
  result[0] = editable ? 1 : 0;
  const auto characters = static_cast<std::uint32_t>(text.size());
  std::memcpy(result.data() + 1, &characters, sizeof(characters));
  std::memcpy(result.data() + 5, text.data(), text.size() * 2);
  return result;
}

PasteResultPayload WindowTargetService::ReplaceSelection() {
  if (!selection_editable_) return {PasteStatus::NotEditable};
  if (!IsTrusted()) return {PasteStatus::HigherIntegrity};
  NSRunningApplication* application = FrontmostApp();
  if (application == nil) return {PasteStatus::TargetChanged};
  const auto process_id =
      static_cast<std::uint32_t>(application.processIdentifier);
  const auto window_id = FrontmostWindowId(process_id);
  if (EncodeHandle(process_id, window_id) != selection_window_handle_ ||
      process_id != selection_process_) {
    return {PasteStatus::TargetChanged};
  }

  AXUIElementRef focused = CopyFocusedElement();
  if (focused == nullptr) return {PasteStatus::TargetChanged};
  std::unique_ptr<const void, CfReleaser> focused_owner(focused);
  CFTypeRef text_ref = nullptr;
  if (AXUIElementCopyAttributeValue(focused, kAXSelectedTextAttribute,
                                    &text_ref) != kAXErrorSuccess ||
      text_ref == nullptr) {
    return {PasteStatus::TargetChanged};
  }
  std::unique_ptr<const void, CfReleaser> text_owner(text_ref);
  if (CFGetTypeID(text_ref) != CFStringGetTypeID()) {
    return {PasteStatus::TargetChanged};
  }
  if (Utf16FromNs((__bridge NSString*)text_ref) != selection_text_) {
    return {PasteStatus::TargetChanged};
  }
  if (ModifierHeld()) return {PasteStatus::SendInputFailed};
  const auto result = Paste({selection_window_handle_, selection_process_});
  if (result.status == PasteStatus::Success) ClearSelection();
  return result;
}

}  // namespace untypo
