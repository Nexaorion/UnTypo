#pragma once

#include <cstddef>
#include <cstdint>

namespace untypo {

constexpr std::uint32_t kProtocolMagic = 0x50595455;
constexpr std::uint16_t kProtocolVersion = 3;
constexpr std::uint32_t kMaximumPayloadBytes = 1024 * 1024;
constexpr std::size_t kMaximumTargetContextCharacters = 512;

enum class MessageType : std::uint16_t {
  Authenticate = 1,
  ConfigureHotkey = 2,
  CaptureTarget = 3,
  Paste = 4,
  Ping = 5,
  Shutdown = 6,
  HotkeyEvent = 100,
  Authenticated = 101,
  TargetCaptured = 102,
  PasteResult = 103,
  Pong = 104,
  HotkeyConfigured = 105,
  Error = 106,
};

enum class HotkeyAction : std::uint8_t {
  Toggle = 3,
};

enum class PasteStatus : std::uint8_t {
  Success = 1,
  TargetChanged = 2,
  NotEditable = 3,
  HigherIntegrity = 4,
  SendInputFailed = 5,
};

#pragma pack(push, 1)
struct FrameHeader {
  std::uint32_t magic;
  std::uint16_t version;
  std::uint16_t message_type;
  std::uint32_t payload_bytes;
};

struct HotkeyConfiguration {
  std::uint32_t virtual_key;
  std::uint32_t modifiers;
};

struct HotkeyConfigurationResultPayload {
  std::uint32_t error_code;
};

struct HotkeyEventPayload {
  HotkeyAction action;
};

struct TargetSnapshotHeader {
  std::uint64_t window_handle;
  std::uint32_t process_id;
  std::uint8_t editable;
  std::uint8_t higher_integrity;
};

struct PasteRequestPayload {
  std::uint64_t window_handle;
  std::uint32_t process_id;
};

struct PasteResultPayload {
  PasteStatus status;
};
#pragma pack(pop)

static_assert(sizeof(FrameHeader) == 12);
static_assert(sizeof(HotkeyConfiguration) == 8);
static_assert(sizeof(HotkeyConfigurationResultPayload) == 4);
static_assert(sizeof(TargetSnapshotHeader) == 14);
static_assert(sizeof(PasteRequestPayload) == 12);

}  // namespace untypo
