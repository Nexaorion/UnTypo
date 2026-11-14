#include "focus_probe.h"

#include <dlfcn.h>

#include <cstring>
#include <mutex>

#include <atspi/atspi.h>

namespace untypo {
namespace {
constexpr int kMaximumDepth = 8;
constexpr int kNodeBudget = 256;
constexpr int kDesktopChildCap = 64;
constexpr int kChildCap = 48;
constexpr int kDesktopCap = 4;

using InitFunction = int (*)();
using SetTimeoutFunction = void (*)(gint, gint);
using DesktopCountFunction = gint (*)();
using GetDesktopFunction = AtspiAccessible* (*)(gint);
using ChildCountFunction = gint (*)(AtspiAccessible*, GError**);
using ChildAtFunction = AtspiAccessible* (*)(AtspiAccessible*, gint, GError**);
using StateSetFunction = AtspiStateSet* (*)(AtspiAccessible*);
using ContainsFunction = gboolean (*)(AtspiStateSet*, AtspiStateType);
using ProcessIdFunction = guint (*)(AtspiAccessible*, GError**);
using UnrefFunction = void (*)(void*);

struct Library {
  void* atspi = nullptr;
  void* gobject = nullptr;
  InitFunction init = nullptr;
  SetTimeoutFunction set_timeout = nullptr;
  DesktopCountFunction desktop_count = nullptr;
  GetDesktopFunction get_desktop = nullptr;
  ChildCountFunction child_count = nullptr;
  ChildAtFunction child_at = nullptr;
  StateSetFunction state_set = nullptr;
  ContainsFunction contains = nullptr;
  ProcessIdFunction process_id = nullptr;
  UnrefFunction unref = nullptr;
  bool unavailable = false;
  bool ready = false;
};

class ScopedUnref {
 public:
  ScopedUnref(UnrefFunction unref, void* object) : unref_(unref), object_(object) {}
  ~ScopedUnref() {
    if (unref_ != nullptr && object_ != nullptr) unref_(object_);
  }
  ScopedUnref(const ScopedUnref&) = delete;
  ScopedUnref& operator=(const ScopedUnref&) = delete;

 private:
  UnrefFunction unref_;
  void* object_;
};

template <typename Function>
Function LoadSymbol(void* handle, const char* name) {
  void* symbol = dlsym(handle, name);
  Function function = nullptr;
  static_assert(sizeof(Function) == sizeof(void*));
  std::memcpy(&function, &symbol, sizeof(function));
  return function;
}

void* OpenAtspi() {
  const char* candidates[] = {
      "libatspi.so.0",
      "/usr/lib/x86_64-linux-gnu/libatspi.so.0",
      "/usr/lib64/libatspi.so.0",
      "/usr/lib/libatspi.so.0",
  };
  for (const char* candidate : candidates) {
    void* handle = dlopen(candidate, RTLD_NOW | RTLD_LOCAL);
    if (handle != nullptr) return handle;
  }
  return nullptr;
}

bool LoadLibrary(Library& library) {
  library.atspi = OpenAtspi();
  if (library.atspi == nullptr) return false;
  library.init = LoadSymbol<InitFunction>(library.atspi, "atspi_init");
  library.set_timeout = LoadSymbol<SetTimeoutFunction>(library.atspi, "atspi_set_timeout");
  library.desktop_count = LoadSymbol<DesktopCountFunction>(library.atspi, "atspi_get_desktop_count");
  library.get_desktop = LoadSymbol<GetDesktopFunction>(library.atspi, "atspi_get_desktop");
  library.child_count =
      LoadSymbol<ChildCountFunction>(library.atspi, "atspi_accessible_get_child_count");
  library.child_at =
      LoadSymbol<ChildAtFunction>(library.atspi, "atspi_accessible_get_child_at_index");
  library.state_set = LoadSymbol<StateSetFunction>(library.atspi, "atspi_accessible_get_state_set");
  library.contains = LoadSymbol<ContainsFunction>(library.atspi, "atspi_state_set_contains");
  library.process_id =
      LoadSymbol<ProcessIdFunction>(library.atspi, "atspi_accessible_get_process_id");
  library.unref = LoadSymbol<UnrefFunction>(library.atspi, "g_object_unref");
  if (library.unref == nullptr) {
    library.gobject = dlopen("libgobject-2.0.so.0", RTLD_NOW | RTLD_LOCAL);
    if (library.gobject != nullptr) {
      library.unref = LoadSymbol<UnrefFunction>(library.gobject, "g_object_unref");
    }
  }
  return library.init != nullptr && library.desktop_count != nullptr &&
         library.get_desktop != nullptr && library.child_count != nullptr &&
         library.child_at != nullptr && library.state_set != nullptr &&
         library.contains != nullptr && library.process_id != nullptr && library.unref != nullptr;
}

enum class FocusFinding {
  None,
  Editable,
  NotEditable,
};

FocusFinding Walk(const Library& library, AtspiAccessible* node, int depth, int& budget,
                  guint process_id, bool ancestor_matches, bool desktop) {
  if (node == nullptr) return FocusFinding::None;
  const ScopedUnref node_ref(library.unref, node);
  if (budget <= 0) return FocusFinding::None;
  --budget;

  const guint node_process = library.process_id(node, nullptr);
  if (node_process != 0 && node_process != process_id) return FocusFinding::None;
  const bool matches = ancestor_matches || node_process == process_id;

  bool focused = false;
  bool editable = false;
  bool manages_descendants = false;
  AtspiStateSet* states = library.state_set(node);
  if (states != nullptr) {
    const ScopedUnref state_ref(library.unref, states);
    focused = library.contains(states, ATSPI_STATE_FOCUSED) != FALSE;
    editable = library.contains(states, ATSPI_STATE_EDITABLE) != FALSE &&
               library.contains(states, ATSPI_STATE_READ_ONLY) == FALSE;
    manages_descendants = library.contains(states, ATSPI_STATE_MANAGES_DESCENDANTS) != FALSE;
  }

  if (matches && focused && editable) return FocusFinding::Editable;
  if (manages_descendants) return matches && focused ? FocusFinding::NotEditable : FocusFinding::None;
  if (depth >= kMaximumDepth) return matches && focused ? FocusFinding::NotEditable : FocusFinding::None;

  gint children = library.child_count(node, nullptr);
  if (children < 0) children = 0;
  const int cap = desktop ? kDesktopChildCap : kChildCap;
  if (children > cap) children = cap;
  FocusFinding nested = FocusFinding::None;
  for (gint index = 0; index < children && budget > 0; ++index) {
    AtspiAccessible* child = library.child_at(node, index, nullptr);
    const auto finding =
        Walk(library, child, depth + 1, budget, process_id, matches, false);
    if (finding == FocusFinding::Editable) return FocusFinding::Editable;
    if (finding == FocusFinding::NotEditable) nested = FocusFinding::NotEditable;
  }
  if (nested == FocusFinding::NotEditable) return FocusFinding::NotEditable;
  return matches && focused ? FocusFinding::NotEditable : FocusFinding::None;
}

bool EnsureReady(Library& library) {
  if (library.ready) return true;
  if (library.unavailable) return false;
  if (!LoadLibrary(library)) {
    library.unavailable = true;
    return false;
  }
  if (library.set_timeout != nullptr) library.set_timeout(250, 250);
  if (library.init() != 0) {
    library.unavailable = true;
    return false;
  }
  library.ready = true;
  return true;
}
}  // namespace

LinuxEditability ProbeFocusedEditability(std::uint32_t process_id) {
  if (process_id == 0) return LinuxEditability::Unknown;
  static std::mutex mutex;
  static Library library;
  const std::lock_guard<std::mutex> lock(mutex);
  // A missing accessibility bus stays failed so later pastes do not each pay the startup timeout.
  if (!EnsureReady(library)) return LinuxEditability::Unknown;

  int budget = kNodeBudget;
  gint desktops = library.desktop_count();
  if (desktops < 0) desktops = 0;
  if (desktops > kDesktopCap) desktops = kDesktopCap;
  FocusFinding finding = FocusFinding::None;
  for (gint index = 0; index < desktops && budget > 0; ++index) {
    const auto nested = Walk(library, library.get_desktop(index), 0, budget,
                             static_cast<guint>(process_id), false, true);
    if (nested == FocusFinding::Editable) return LinuxEditability::Editable;
    if (nested == FocusFinding::NotEditable) finding = FocusFinding::NotEditable;
  }
  return finding == FocusFinding::NotEditable ? LinuxEditability::NotEditable
                                              : LinuxEditability::Unknown;
}
}  // namespace untypo
