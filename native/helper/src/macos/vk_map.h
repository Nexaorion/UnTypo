#pragma once

#include <cstdint>

namespace untypo {

bool MapWin32VirtualKey(std::uint32_t virtual_key, std::uint16_t* key_code);
std::uint32_t MapWin32Modifiers(std::uint32_t modifiers);

}  // namespace untypo
