cmake_minimum_required(VERSION 3.20)
if(APPLE)
  project(untypo_native_helper LANGUAGES CXX OBJCXX)
else()
  project(untypo_native_helper LANGUAGES CXX)
endif()

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
if(APPLE)
  set(CMAKE_OBJCXX_STANDARD 20)
  set(CMAKE_OBJCXX_STANDARD_REQUIRED ON)
  set(CMAKE_OSX_ARCHITECTURES "arm64")
  set(CMAKE_OSX_DEPLOYMENT_TARGET "12.0")
  add_executable(untypo_native_helper
    src/macos/hotkey_monitor.mm src/macos/main.mm
    src/macos/socket_server.cpp src/macos/vk_map.cpp src/macos/window_target.mm)
  target_include_directories(untypo_native_helper PRIVATE src src/macos)
elseif(UNIX)
  find_package(PkgConfig REQUIRED)
  pkg_check_modules(ATSPI2 REQUIRED atspi-2)
  find_package(Threads REQUIRED)
  add_executable(untypo_native_helper
    src/linux/focus_probe.cpp src/linux/hotkey_monitor.cpp src/linux/main.cpp
    src/linux/window_target.cpp src/macos/socket_server.cpp)
  target_include_directories(untypo_native_helper PRIVATE src src/linux src/macos)
  # Headers provide the AT-SPI enums. libatspi is dlopened so a missing library cannot block startup.
  target_include_directories(untypo_native_helper SYSTEM PRIVATE ${ATSPI2_INCLUDE_DIRS})
  target_link_libraries(untypo_native_helper PRIVATE Threads::Threads ${CMAKE_DL_LIBS})
endif()

target_compile_options(untypo_native_helper PRIVATE
  -Wall
  -Wextra
  -Werror
  $<$<COMPILE_LANGUAGE:OBJCXX>:-fobjc-arc>
)

if(APPLE)
  target_link_libraries(untypo_native_helper PRIVATE
    "-framework AppKit" "-framework ApplicationServices" "-framework Carbon"
    "-framework CoreFoundation" "-framework CoreGraphics")
endif()

set(HELPER_OUTPUT_DIR "${CMAKE_SOURCE_DIR}/../../build/Release")
set_target_properties(untypo_native_helper PROPERTIES
  RUNTIME_OUTPUT_DIRECTORY "${HELPER_OUTPUT_DIR}"
  RUNTIME_OUTPUT_DIRECTORY_DEBUG "${HELPER_OUTPUT_DIR}"
  RUNTIME_OUTPUT_DIRECTORY_RELEASE "${HELPER_OUTPUT_DIR}"
)
