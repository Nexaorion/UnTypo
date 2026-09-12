cmake_minimum_required(VERSION 3.20)
project(untypo_native_helper LANGUAGES CXX OBJCXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_OBJCXX_STANDARD 20)
set(CMAKE_OBJCXX_STANDARD_REQUIRED ON)
set(CMAKE_OSX_ARCHITECTURES "arm64")
set(CMAKE_OSX_DEPLOYMENT_TARGET "12.0")

add_executable(untypo_native_helper
  src/macos/hotkey_monitor.mm
  src/macos/main.mm
  src/macos/socket_server.cpp
  src/macos/vk_map.cpp
  src/macos/window_target.mm
)

target_include_directories(untypo_native_helper PRIVATE src src/macos)

target_compile_options(untypo_native_helper PRIVATE
  -Wall
  -Wextra
  -Werror
  $<$<COMPILE_LANGUAGE:OBJCXX>:-fobjc-arc>
)

target_link_libraries(untypo_native_helper PRIVATE
  "-framework AppKit"
  "-framework ApplicationServices"
  "-framework Carbon"
  "-framework CoreFoundation"
  "-framework CoreGraphics"
)

set(HELPER_OUTPUT_DIR "${CMAKE_SOURCE_DIR}/../../build/Release")
set_target_properties(untypo_native_helper PROPERTIES
  RUNTIME_OUTPUT_DIRECTORY "${HELPER_OUTPUT_DIR}"
  RUNTIME_OUTPUT_DIRECTORY_DEBUG "${HELPER_OUTPUT_DIR}"
  RUNTIME_OUTPUT_DIRECTORY_RELEASE "${HELPER_OUTPUT_DIR}"
)
