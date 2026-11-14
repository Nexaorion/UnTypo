#include "window_target.h"

#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <spawn.h>
#include <sys/wait.h>
#include <unistd.h>

#include <algorithm>
#include <cctype>
#include <chrono>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <string>
#include <string_view>
#include <vector>

#include "focus_probe.h"

extern char** environ;

namespace untypo {
namespace {
constexpr std::chrono::milliseconds kCommandTimeout{2000};
constexpr std::size_t kOutputCap = 8192;

struct CommandResult {
  bool ok = false;
  std::string output;
};

bool ValidArguments(const std::vector<std::string>& arguments) {
  if (arguments.empty()) return false;
  for (const auto& argument : arguments) {
    if (argument.empty() || argument.find('\0') != std::string::npos) return false;
  }
  return true;
}

class SpawnActions {
 public:
  SpawnActions() { active_ = posix_spawn_file_actions_init(&actions_) == 0; }
  ~SpawnActions() {
    if (active_) posix_spawn_file_actions_destroy(&actions_);
  }
  SpawnActions(const SpawnActions&) = delete;
  SpawnActions& operator=(const SpawnActions&) = delete;
  posix_spawn_file_actions_t* get() { return active_ ? &actions_ : nullptr; }

 private:
  posix_spawn_file_actions_t actions_{};
  bool active_ = false;
};

bool WaitChild(pid_t child, std::chrono::steady_clock::time_point deadline, int& status) {
  while (true) {
    const pid_t waited = ::waitpid(child, &status, WNOHANG);
    if (waited == child) return true;
    if (waited < 0) {
      if (errno == EINTR) continue;
      return false;
    }
    if (std::chrono::steady_clock::now() >= deadline) {
      ::kill(child, SIGKILL);
      while (::waitpid(child, &status, 0) < 0 && errno == EINTR) {
      }
      return false;
    }
    ::poll(nullptr, 0, 20);
  }
}

std::string ReadOutput(int fd, pid_t child, std::chrono::steady_clock::time_point deadline,
                       bool& timed_out) {
  std::string output;
  const int flags = ::fcntl(fd, F_GETFL);
  if (flags >= 0) ::fcntl(fd, F_SETFL, flags | O_NONBLOCK);
  while (!timed_out) {
    char buffer[512];
    const ssize_t read_bytes = ::read(fd, buffer, sizeof(buffer));
    if (read_bytes > 0) {
      const auto room = output.size() < kOutputCap ? kOutputCap - output.size() : 0;
      if (room > 0) {
        const auto count = std::min<std::size_t>(room, static_cast<std::size_t>(read_bytes));
        output.append(buffer, count);
      }
      continue;
    }
    if (read_bytes == 0) return output;
    if (errno != EAGAIN && errno != EWOULDBLOCK) return output;
    if (std::chrono::steady_clock::now() >= deadline) {
      timed_out = true;
      ::kill(child, SIGKILL);
      return {};
    }
    pollfd ready{fd, POLLIN, 0};
    const auto remaining = std::chrono::duration_cast<std::chrono::milliseconds>(
                               deadline - std::chrono::steady_clock::now())
                               .count();
    const int timeout = static_cast<int>(std::clamp<std::int64_t>(remaining, 0, 200));
    ::poll(&ready, 1, timeout);
  }
  return {};
}

void TrimTrailingNewline(std::string& output) {
  while (!output.empty() && (output.back() == '\n' || output.back() == '\r')) output.pop_back();
}

CommandResult RunArgv(const std::vector<std::string>& arguments, bool capture_output) {
  if (!ValidArguments(arguments)) return {};
  std::vector<char*> argv;
  argv.reserve(arguments.size() + 1);
  for (const auto& argument : arguments) argv.push_back(const_cast<char*>(argument.c_str()));
  argv.push_back(nullptr);

  int pipe_fds[2] = {-1, -1};
  if (capture_output && ::pipe2(pipe_fds, O_CLOEXEC) != 0) return {};
  const int devnull = ::open("/dev/null", O_RDWR | O_CLOEXEC);
  SpawnActions actions;
  bool prepared = actions.get() != nullptr && devnull >= 0;
  if (prepared) {
    prepared = posix_spawn_file_actions_adddup2(actions.get(), devnull, STDERR_FILENO) == 0;
  }
  if (prepared && !capture_output) {
    prepared = posix_spawn_file_actions_adddup2(actions.get(), devnull, STDOUT_FILENO) == 0;
  }
  if (prepared && capture_output) {
    prepared = posix_spawn_file_actions_adddup2(actions.get(), pipe_fds[1], STDOUT_FILENO) == 0 &&
               posix_spawn_file_actions_addclose(actions.get(), pipe_fds[0]) == 0 &&
               posix_spawn_file_actions_addclose(actions.get(), pipe_fds[1]) == 0;
  }
  if (prepared) prepared = posix_spawn_file_actions_addclose(actions.get(), devnull) == 0;

  pid_t child = 0;
  const int spawned = prepared ? ::posix_spawnp(&child, argv[0], actions.get(), nullptr, argv.data(),
                                                environ)
                               : -1;
  if (devnull >= 0) ::close(devnull);
  if (capture_output) ::close(pipe_fds[1]);
  if (spawned != 0) {
    if (capture_output) ::close(pipe_fds[0]);
    return {};
  }

  const auto deadline = std::chrono::steady_clock::now() + kCommandTimeout;
  bool timed_out = false;
  std::string output;
  if (capture_output) {
    output = ReadOutput(pipe_fds[0], child, deadline, timed_out);
    ::close(pipe_fds[0]);
    if (timed_out) {
      int status = 0;
      while (::waitpid(child, &status, 0) < 0 && errno == EINTR) {
      }
      return {};
    }
  }

  int status = 0;
  if (!WaitChild(child, deadline, status) || !WIFEXITED(status) || WEXITSTATUS(status) != 0) {
    return {};
  }
  TrimTrailingNewline(output);
  return {true, std::move(output)};
}

std::uint32_t ParseId(std::string_view value) {
  if (value.empty()) return 0;
  std::uint64_t parsed = 0;
  for (const char character : value) {
    if (character < '0' || character > '9') return 0;
    parsed = parsed * 10 + static_cast<std::uint64_t>(character - '0');
    if (parsed > 0xffffffffu) return 0;
  }
  return static_cast<std::uint32_t>(parsed);
}

bool EqualsIgnoreCase(const char* value, const char* expected) {
  if (value == nullptr) return false;
  for (std::size_t index = 0; expected[index] != '\0'; ++index) {
    const auto actual = static_cast<unsigned char>(value[index]);
    const auto wanted = static_cast<unsigned char>(expected[index]);
    if (actual == '\0' || std::tolower(actual) != std::tolower(wanted)) return false;
  }
  return value[std::strlen(expected)] == '\0';
}

bool X11PasteAvailable(const char* display, const char* wayland, const char* session) {
  if (display == nullptr || display[0] == '\0') return false;
  if (wayland != nullptr && wayland[0] != '\0') return false;
  if (EqualsIgnoreCase(session, "wayland")) return false;
  return true;
}

std::uint32_t ActiveWindowId() {
  const auto result = RunArgv({"xdotool", "getactivewindow"}, true);
  return result.ok ? ParseId(result.output) : 0;
}

std::uint32_t WindowProcessId(std::uint32_t window) {
  if (window == 0) return 0;
  const auto result = RunArgv({"xdotool", "getwindowpid", std::to_string(window)}, true);
  return result.ok ? ParseId(result.output) : 0;
}

std::string ProcessName(std::uint32_t process_id) {
  if (process_id == 0) return {};
  const auto path = "/proc/" + std::to_string(process_id) + "/exe";
  char buffer[4096];
  const ssize_t length = ::readlink(path.c_str(), buffer, sizeof(buffer) - 1);
  if (length > 0 && static_cast<std::size_t>(length) < sizeof(buffer) - 1) {
    buffer[length] = '\0';
    const std::string executable(buffer, static_cast<std::size_t>(length));
    const auto slash = executable.find_last_of('/');
    const auto name = slash == std::string::npos ? executable : executable.substr(slash + 1);
    if (!name.empty()) return name;
  }
  std::ifstream command("/proc/" + std::to_string(process_id) + "/comm");
  std::string name;
  std::getline(command, name);
  while (!name.empty() && (name.back() == '\n' || name.back() == '\r')) name.pop_back();
  return name;
}

std::vector<std::uint8_t> EncodeUtf16Field(std::string_view value) {
  std::u16string units;
  const auto* bytes = reinterpret_cast<const unsigned char*>(value.data());
  std::size_t index = 0;
  while (index < value.size() && units.size() < kMaximumTargetContextCharacters) {
    const unsigned char lead = bytes[index];
    int need = 0;
    char32_t code_point = 0;
    if (lead < 0x80) {
      need = 1;
      code_point = lead;
    } else if ((lead & 0xE0) == 0xC0) {
      need = 2;
      code_point = lead & 0x1F;
    } else if ((lead & 0xF0) == 0xE0) {
      need = 3;
      code_point = lead & 0x0F;
    } else if ((lead & 0xF8) == 0xF0) {
      need = 4;
      code_point = lead & 0x07;
    } else {
      units.push_back(static_cast<char16_t>(0xFFFD));
      ++index;
      continue;
    }
    if (index + static_cast<std::size_t>(need) > value.size()) {
      units.push_back(static_cast<char16_t>(0xFFFD));
      break;
    }
    bool valid = true;
    for (int extra = 1; extra < need; ++extra) {
      const unsigned char next = bytes[index + static_cast<std::size_t>(extra)];
      if ((next & 0xC0) != 0x80) {
        valid = false;
        break;
      }
      code_point = (code_point << 6) | (next & 0x3F);
    }
    const bool overlong = (need == 2 && code_point < 0x80) || (need == 3 && code_point < 0x800) ||
                          (need == 4 && code_point < 0x10000);
    const bool unicode = code_point <= 0x10FFFF && (code_point < 0xD800 || code_point > 0xDFFF);
    if (!valid || overlong || !unicode) {
      units.push_back(static_cast<char16_t>(0xFFFD));
      index += valid ? static_cast<std::size_t>(need) : 1;
      continue;
    }
    if (code_point >= 0x10000) {
      if (units.size() + 2 > kMaximumTargetContextCharacters) break;
      const auto shifted = code_point - 0x10000;
      units.push_back(static_cast<char16_t>(0xD800 + ((shifted >> 10) & 0x3FF)));
      units.push_back(static_cast<char16_t>(0xDC00 + (shifted & 0x3FF)));
    } else {
      units.push_back(static_cast<char16_t>(code_point));
    }
    index += static_cast<std::size_t>(need);
  }

  std::vector<std::uint8_t> field;
  field.push_back(static_cast<std::uint8_t>(units.size() & 0xff));
  field.push_back(static_cast<std::uint8_t>(units.size() >> 8));
  for (const char16_t unit : units) {
    field.push_back(static_cast<std::uint8_t>(unit & 0xff));
    field.push_back(static_cast<std::uint8_t>(unit >> 8));
  }
  return field;
}

void AppendField(std::vector<std::uint8_t>& payload, std::string_view value) {
  const auto field = EncodeUtf16Field(value);
  payload.insert(payload.end(), field.begin(), field.end());
}

std::vector<std::uint8_t> Snapshot(std::uint32_t window, std::uint32_t process, bool editable,
                                   std::string_view title, std::string_view name) {
  TargetSnapshotHeader header{};
  header.window_handle = window;
  header.process_id = process;
  header.editable = editable ? 1 : 0;
  header.higher_integrity = 0;
  std::vector<std::uint8_t> payload(sizeof(header));
  std::memcpy(payload.data(), &header, sizeof(header));
  AppendField(payload, title);
  AppendField(payload, name);
  return payload;
}

struct PastePlan {
  PasteStatus status;
  bool send;
};

PastePlan PlanLinuxPaste(bool x11_available, bool target_matches, LinuxEditability editability,
                         bool command_ok) {
  if (!x11_available || !target_matches) return {PasteStatus::TargetChanged, false};
  if (editability == LinuxEditability::NotEditable) return {PasteStatus::NotEditable, false};
  if (!command_ok) return {PasteStatus::SendInputFailed, true};
  if (editability == LinuxEditability::Editable) return {PasteStatus::Success, true};
  // Ctrl+V can run when editability is unknown, but that is not proof the text was inserted.
  return {PasteStatus::NotEditable, true};
}

bool ShouldSendPaste(bool x11_available, bool target_matches, LinuxEditability editability) {
  return PlanLinuxPaste(x11_available, target_matches, editability, true).send;
}

bool BytesMatch(const std::vector<std::uint8_t>& actual, std::initializer_list<std::uint8_t> expected) {
  return actual.size() == expected.size() && std::equal(actual.begin(), actual.end(), expected.begin());
}

int Fail(const char* check) {
  std::fprintf(stderr, "linux helper self-test failed: %s\n", check);
  return 1;
}
}  // namespace

std::vector<std::uint8_t> WindowTargetService::Capture() const {
  const bool x11 = X11PasteAvailable(std::getenv("DISPLAY"), std::getenv("WAYLAND_DISPLAY"),
                                     std::getenv("XDG_SESSION_TYPE"));
  if (!x11) return Snapshot(0, 0, false, "", "");
  const auto window = ActiveWindowId();
  if (window == 0) return Snapshot(0, 0, false, "", "");
  const auto process = WindowProcessId(window);
  const auto title = RunArgv({"xdotool", "getwindowname", std::to_string(window)}, true);
  const auto editability =
      process == 0 ? LinuxEditability::Unknown : ProbeFocusedEditability(process);
  return Snapshot(window, process, editability == LinuxEditability::Editable,
                  title.ok ? title.output : std::string_view{}, ProcessName(process));
}

PasteResultPayload WindowTargetService::Paste(const PasteRequestPayload& request) const {
  const bool x11 = X11PasteAvailable(std::getenv("DISPLAY"), std::getenv("WAYLAND_DISPLAY"),
                                     std::getenv("XDG_SESSION_TYPE"));
  const auto window = x11 ? ActiveWindowId() : 0;
  const auto process = x11 ? WindowProcessId(window) : 0;
  const bool own_process =
      process != 0 && static_cast<std::uint64_t>(process) == static_cast<std::uint64_t>(::getpid());
  const bool target_matches = window != 0 && process != 0 && !own_process &&
                              static_cast<std::uint64_t>(window) == request.window_handle &&
                              process == request.process_id;
  const auto editability =
      target_matches ? ProbeFocusedEditability(process) : LinuxEditability::Unknown;
  if (!ShouldSendPaste(x11, target_matches, editability)) {
    return {PlanLinuxPaste(x11, target_matches, editability, true).status};
  }
  const auto pasted = RunArgv(
      {"xdotool", "key", "--window", std::to_string(window), "--clearmodifiers", "ctrl+v"}, false);
  return {PlanLinuxPaste(x11, target_matches, editability, pasted.ok).status};
}

std::vector<std::uint8_t> WindowTargetService::CaptureSelection() {
  return std::vector<std::uint8_t>(5, 0);
}

PasteResultPayload WindowTargetService::ReplaceSelection() { return {PasteStatus::NotEditable}; }

void WindowTargetService::ClearSelection() {}

int RunLinuxHelperSelfTest() {
  const auto wechat = EncodeUtf16Field(std::string("\xE5\xBE\xAE\xE4\xBF\xA1", 6));
  if (!BytesMatch(wechat, {0x02, 0x00, 0xAE, 0x5F, 0xE1, 0x4F})) return Fail("wechat utf-8");
  const auto emoji = EncodeUtf16Field(std::string("\xF0\x9F\x96\xA4", 4));
  if (!BytesMatch(emoji, {0x02, 0x00, 0x3D, 0xD8, 0xA4, 0xDD})) return Fail("emoji surrogate");
  if (!BytesMatch(EncodeUtf16Field(std::string("\xFF", 1)), {0x01, 0x00, 0xFD, 0xFF})) {
    return Fail("invalid utf-8");
  }
  if (!BytesMatch(EncodeUtf16Field(std::string("\xC0\x80", 2)), {0x01, 0x00, 0xFD, 0xFF})) {
    return Fail("overlong utf-8");
  }

  std::string below_cap(510, 'a');
  below_cap.append("\xF0\x9F\x96\xA4", 4);
  const auto fitted = EncodeUtf16Field(below_cap);
  if (fitted.size() < 6 || fitted[0] != 0x00 || fitted[1] != 0x02) return Fail("surrogate fits");
  if (fitted[fitted.size() - 4] != 0x3D || fitted[fitted.size() - 3] != 0xD8 ||
      fitted[fitted.size() - 2] != 0xA4 || fitted[fitted.size() - 1] != 0xDD) {
    return Fail("surrogate bytes");
  }
  std::string at_cap(511, 'a');
  at_cap.append("\xF0\x9F\x96\xA4", 4);
  const auto truncated = EncodeUtf16Field(at_cap);
  if (truncated.size() != 2 + 511 * 2 || truncated[0] != 0xFF || truncated[1] != 0x01) {
    return Fail("surrogate is not split");
  }
  if (truncated[truncated.size() - 2] != 'a' || truncated[truncated.size() - 1] != 0) {
    return Fail("truncated tail");
  }

  if (ParseId("1;id") != 0 || ParseId(" 12") != 0 || ParseId("") != 0 || ParseId("12 ") != 0 ||
      ParseId("-1") != 0 || ParseId("4294967296") != 0) {
    return Fail("rejected ids");
  }
  if (ParseId("12") != 12 || ParseId("4294967295") != 4294967295u) return Fail("accepted ids");

  if (X11PasteAvailable(nullptr, nullptr, nullptr) || X11PasteAvailable("", nullptr, "x11") ||
      X11PasteAvailable(":0", "wayland-0", "x11") || X11PasteAvailable(":0", nullptr, "wayland") ||
      X11PasteAvailable(":0", "", "Wayland")) {
    return Fail("x11 gate rejects");
  }
  if (!X11PasteAvailable(":0", nullptr, nullptr) || !X11PasteAvailable(":0", "", "x11")) {
    return Fail("x11 gate accepts");
  }

  const auto changed = PlanLinuxPaste(false, true, LinuxEditability::Editable, true);
  if (changed.send || changed.status != PasteStatus::TargetChanged) return Fail("wayland plan");
  const auto mismatch = PlanLinuxPaste(true, false, LinuxEditability::Editable, true);
  if (mismatch.send || mismatch.status != PasteStatus::TargetChanged) return Fail("mismatch plan");
  const auto blocked = PlanLinuxPaste(true, true, LinuxEditability::NotEditable, true);
  if (blocked.send || blocked.status != PasteStatus::NotEditable) return Fail("not editable plan");
  const auto inserted = PlanLinuxPaste(true, true, LinuxEditability::Editable, true);
  if (!inserted.send || inserted.status != PasteStatus::Success) return Fail("editable success");
  const auto send_failed = PlanLinuxPaste(true, true, LinuxEditability::Editable, false);
  if (!send_failed.send || send_failed.status != PasteStatus::SendInputFailed) {
    return Fail("editable failure");
  }
  const auto unconfirmed = PlanLinuxPaste(true, true, LinuxEditability::Unknown, true);
  if (!unconfirmed.send || unconfirmed.status != PasteStatus::NotEditable) {
    return Fail("unknown success");
  }
  const auto unknown_failed = PlanLinuxPaste(true, true, LinuxEditability::Unknown, false);
  if (!unknown_failed.send || unknown_failed.status != PasteStatus::SendInputFailed) {
    return Fail("unknown failure");
  }

  if (!RunArgv({"true"}, false).ok) return Fail("spawn true");
  if (RunArgv({"untypo-helper-missing-command"}, false).ok) return Fail("missing command");
  if (RunArgv({std::string("a\0b", 3)}, false).ok || RunArgv({""}, false).ok) {
    return Fail("rejected argv");
  }
  const auto printed = RunArgv({"printf", "12345\n"}, true);
  if (!printed.ok || printed.output != "12345") return Fail("captured argv output");
  const auto started = std::chrono::steady_clock::now();
  if (RunArgv({"sleep", "30"}, false).ok) return Fail("timeout killed sleep");
  const auto elapsed = std::chrono::steady_clock::now() - started;
  if (elapsed < std::chrono::milliseconds(500) || elapsed > std::chrono::seconds(5)) {
    return Fail("timeout duration");
  }
  const auto self = ProcessName(static_cast<std::uint32_t>(::getpid()));
  if (self.find("untypo_native_helper") == std::string::npos) return Fail("process name");
  return 0;
}
}  // namespace untypo
