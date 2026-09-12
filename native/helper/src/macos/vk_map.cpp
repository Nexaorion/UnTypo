#include "vk_map.h"

#include <Carbon/Carbon.h>

namespace untypo {

namespace {

constexpr std::uint32_t kWinModAlt = 0x0001;
constexpr std::uint32_t kWinModControl = 0x0002;
constexpr std::uint32_t kWinModShift = 0x0004;
constexpr std::uint32_t kWinModWin = 0x0008;

}  // namespace

bool MapWin32VirtualKey(std::uint32_t virtual_key, std::uint16_t* key_code) {
  if (key_code == nullptr) return false;

  if (virtual_key >= 0x41 && virtual_key <= 0x5a) {
    static constexpr std::uint16_t kLetters[] = {
        kVK_ANSI_A, kVK_ANSI_B, kVK_ANSI_C, kVK_ANSI_D, kVK_ANSI_E, kVK_ANSI_F,
        kVK_ANSI_G, kVK_ANSI_H, kVK_ANSI_I, kVK_ANSI_J, kVK_ANSI_K, kVK_ANSI_L,
        kVK_ANSI_M, kVK_ANSI_N, kVK_ANSI_O, kVK_ANSI_P, kVK_ANSI_Q, kVK_ANSI_R,
        kVK_ANSI_S, kVK_ANSI_T, kVK_ANSI_U, kVK_ANSI_V, kVK_ANSI_W, kVK_ANSI_X,
        kVK_ANSI_Y, kVK_ANSI_Z,
    };
    *key_code = kLetters[virtual_key - 0x41];
    return true;
  }

  if (virtual_key >= 0x30 && virtual_key <= 0x39) {
    static constexpr std::uint16_t kDigits[] = {
        kVK_ANSI_0, kVK_ANSI_1, kVK_ANSI_2, kVK_ANSI_3, kVK_ANSI_4,
        kVK_ANSI_5, kVK_ANSI_6, kVK_ANSI_7, kVK_ANSI_8, kVK_ANSI_9,
    };
    *key_code = kDigits[virtual_key - 0x30];
    return true;
  }

  if (virtual_key >= 0x60 && virtual_key <= 0x69) {
    static constexpr std::uint16_t kNumpad[] = {
        kVK_ANSI_Keypad0, kVK_ANSI_Keypad1, kVK_ANSI_Keypad2, kVK_ANSI_Keypad3,
        kVK_ANSI_Keypad4, kVK_ANSI_Keypad5, kVK_ANSI_Keypad6, kVK_ANSI_Keypad7,
        kVK_ANSI_Keypad8, kVK_ANSI_Keypad9,
    };
    *key_code = kNumpad[virtual_key - 0x60];
    return true;
  }

  if (virtual_key >= 0x70 && virtual_key <= 0x83) {
    static constexpr std::uint16_t kFunction[] = {
        kVK_F1,  kVK_F2,  kVK_F3,  kVK_F4,  kVK_F5,  kVK_F6,  kVK_F7,
        kVK_F8,  kVK_F9,  kVK_F10, kVK_F11, kVK_F12, kVK_F13, kVK_F14,
        kVK_F15, kVK_F16, kVK_F17, kVK_F18, kVK_F19, kVK_F20,
    };
    *key_code = kFunction[virtual_key - 0x70];
    return true;
  }

  switch (virtual_key) {
    case 0x08:
      *key_code = kVK_Delete;
      return true;
    case 0x09:
      *key_code = kVK_Tab;
      return true;
    case 0x0d:
      *key_code = kVK_Return;
      return true;
    case 0x12:
      *key_code = kVK_Option;
      return true;
    case 0x1b:
      *key_code = kVK_Escape;
      return true;
    case 0x20:
      *key_code = kVK_Space;
      return true;
    case 0x21:
      *key_code = kVK_PageUp;
      return true;
    case 0x22:
      *key_code = kVK_PageDown;
      return true;
    case 0x23:
      *key_code = kVK_End;
      return true;
    case 0x24:
      *key_code = kVK_Home;
      return true;
    case 0x25:
      *key_code = kVK_LeftArrow;
      return true;
    case 0x26:
      *key_code = kVK_UpArrow;
      return true;
    case 0x27:
      *key_code = kVK_RightArrow;
      return true;
    case 0x28:
      *key_code = kVK_DownArrow;
      return true;
    case 0x2e:
      *key_code = kVK_ForwardDelete;
      return true;
    case 0x6a:
      *key_code = kVK_ANSI_KeypadMultiply;
      return true;
    case 0x6b:
      *key_code = kVK_ANSI_KeypadPlus;
      return true;
    case 0x6d:
      *key_code = kVK_ANSI_KeypadMinus;
      return true;
    case 0x6e:
      *key_code = kVK_ANSI_KeypadDecimal;
      return true;
    case 0x6f:
      *key_code = kVK_ANSI_KeypadDivide;
      return true;
    case 0x84:
    case 0x85:
    case 0x86:
    case 0x87:
      return false;
    default:
      return false;
  }
}

std::uint32_t MapWin32Modifiers(std::uint32_t modifiers) {
  std::uint32_t carbon = 0;
  if ((modifiers & kWinModAlt) != 0) carbon |= static_cast<std::uint32_t>(optionKey);
  if ((modifiers & kWinModControl) != 0)
    carbon |= static_cast<std::uint32_t>(controlKey);
  if ((modifiers & kWinModShift) != 0) carbon |= static_cast<std::uint32_t>(shiftKey);
  if ((modifiers & kWinModWin) != 0) carbon |= static_cast<std::uint32_t>(cmdKey);
  return carbon;
}

}  // namespace untypo
