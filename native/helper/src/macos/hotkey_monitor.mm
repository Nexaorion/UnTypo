#include "hotkey_monitor.h"

#include "vk_map.h"

#include <dispatch/dispatch.h>
#include <fcntl.h>
#include <pthread.h>
#include <sys/file.h>
#include <unistd.h>

#include <cstdlib>
#include <utility>

namespace untypo {

namespace {

constexpr std::uint32_t kWindowsHotkeyAlreadyRegistered = 1409;
constexpr std::uint32_t kWindowsInvalidParameter = 87;

std::string HotkeyLockPath(const HotkeyConfiguration& configuration) {
  const char* tmp = std::getenv("TMPDIR");
  std::string directory = tmp != nullptr && tmp[0] != '\0' ? tmp : "/tmp";
  if (directory.back() != '/') directory.push_back('/');
  return directory + "untypo-hotkey-" +
         std::to_string(configuration.modifiers) + "-" +
         std::to_string(configuration.virtual_key) + ".lock";
}

void ReleaseLock(int& fd, std::string& path) {
  if (fd < 0) return;
  flock(fd, LOCK_UN);
  close(fd);
  if (!path.empty()) unlink(path.c_str());
  fd = -1;
  path.clear();
}

}  // namespace

HotkeyMonitor::HotkeyMonitor() : configuration_{0x78, 0} {}

HotkeyMonitor::~HotkeyMonitor() { Uninstall(); }

bool HotkeyMonitor::Install(Callback callback) {
  if (installed_) return false;
  const EventTypeSpec spec{kEventClassKeyboard, kEventHotKeyPressed};
  if (InstallApplicationEventHandler(&HotkeyMonitor::HandleHotkeyEvent, 1,
                                     &spec, this, &handler_ref_) != noErr) {
    return false;
  }
  callback_ = std::move(callback);
  installed_ = true;
  return true;
}

HotkeyConfigurationResultPayload HotkeyMonitor::Configure(
    const HotkeyConfiguration& configuration) {
  if (!installed_) return {kWindowsInvalidParameter};
  if (pthread_main_np() != 0) return ConfigureOnMainThread(configuration);

  __block HotkeyConfigurationResultPayload result{kWindowsInvalidParameter};
  dispatch_sync(dispatch_get_main_queue(), ^{
    result = ConfigureOnMainThread(configuration);
  });
  return result;
}

void HotkeyMonitor::Uninstall() {
  if (!installed_) return;
  const auto uninstall = ^{
    if (hotkey_ref_ != nullptr) {
      UnregisterEventHotKey(hotkey_ref_);
      hotkey_ref_ = nullptr;
    }
    ReleaseLock(lock_fd_, lock_path_);
    registered_hotkey_id_ = 0;
    if (handler_ref_ != nullptr) {
      RemoveEventHandler(handler_ref_);
      handler_ref_ = nullptr;
    }
    callback_ = nullptr;
    installed_ = false;
  };
  if (pthread_main_np() != 0) {
    uninstall();
    return;
  }
  dispatch_sync(dispatch_get_main_queue(), uninstall);
}

OSStatus HotkeyMonitor::HandleHotkeyEvent(EventHandlerCallRef, EventRef event,
                                          void* user_data) {
  auto* monitor = static_cast<HotkeyMonitor*>(user_data);
  if (monitor == nullptr) return eventNotHandledErr;
  EventHotKeyID identity{};
  if (GetEventParameter(event, kEventParamDirectObject, typeEventHotKeyID,
                        nullptr, sizeof(identity), nullptr,
                        &identity) != noErr) {
    return eventNotHandledErr;
  }
  if (identity.signature != kHotkeySignature ||
      identity.id != monitor->registered_hotkey_id_) {
    return eventNotHandledErr;
  }
  monitor->EmitToggle();
  return noErr;
}

HotkeyConfigurationResultPayload HotkeyMonitor::ConfigureOnMainThread(
    const HotkeyConfiguration& configuration) {
  if (hotkey_ref_ != nullptr &&
      configuration.virtual_key == configuration_.virtual_key &&
      configuration.modifiers == configuration_.modifiers) {
    return {0};
  }

  std::uint16_t key_code = 0;
  if (!MapWin32VirtualKey(configuration.virtual_key, &key_code)) {
    return {kWindowsInvalidParameter};
  }
  const std::uint32_t carbon_modifiers =
      MapWin32Modifiers(configuration.modifiers);
  const std::string next_lock = HotkeyLockPath(configuration);
  const int next_fd = open(next_lock.c_str(), O_CREAT | O_RDWR, 0600);
  if (next_fd < 0) return {kWindowsInvalidParameter};
  if (flock(next_fd, LOCK_EX | LOCK_NB) != 0) {
    close(next_fd);
    return {kWindowsHotkeyAlreadyRegistered};
  }

  const UInt32 candidate_id = registered_hotkey_id_ == kFirstHotkeyId
                                  ? kSecondHotkeyId
                                  : kFirstHotkeyId;
  EventHotKeyRef candidate = nullptr;
  const EventHotKeyID identity{kHotkeySignature, candidate_id};
  const OSStatus status = RegisterEventHotKey(
      key_code, carbon_modifiers, identity, GetApplicationEventTarget(), 0,
      &candidate);
  if (status != noErr) {
    flock(next_fd, LOCK_UN);
    close(next_fd);
    unlink(next_lock.c_str());
    return {status == eventHotKeyExistsErr ? kWindowsHotkeyAlreadyRegistered
                                           : static_cast<std::uint32_t>(status)};
  }

  if (hotkey_ref_ != nullptr) UnregisterEventHotKey(hotkey_ref_);
  ReleaseLock(lock_fd_, lock_path_);
  hotkey_ref_ = candidate;
  lock_fd_ = next_fd;
  lock_path_ = next_lock;
  registered_hotkey_id_ = candidate_id;
  configuration_ = configuration;
  return {0};
}

void HotkeyMonitor::EmitToggle() {
  if (callback_) callback_(HotkeyAction::Toggle);
}

}  // namespace untypo
