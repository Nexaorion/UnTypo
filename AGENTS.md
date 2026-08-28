# UnTypo Development Guide

## Project boundaries

UnTypo is a Windows-first, local-first dictation client built with Electron, React, strict TypeScript, and a C++ native helper. It requires Node `>=22.12` and npm `>=9`. Configuration, history, and BYOK credentials are user-local data; current source and tests are the authority on implemented behavior.

Before working, run `git status --short` and inspect the affected code and adjacent tests. Preserve unrelated changes made by the user or other tasks. Do not commit, push, publish, reset, or clean the working tree unless explicitly asked.

For a settings control, switch, or action that looks functional but is ineffective, trace the complete path: Renderer → shared contract → preload → IPC validation and trusted sender → main runtime → persistence and runtime side effect. A UI-only change does not prove the behavior is fixed.

## Directory ownership

| Path                            | Responsibility                                                                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/core/providers/`           | Electron-independent speech/text provider contracts, pipelines, registries, and implementations.                                            |
| `src/shared/`                   | Cross-process types, IPC channels, and recording/diagnostics contracts.                                                                     |
| `src/main/`                     | Electron lifecycle, windows, trusted IPC, configuration/history, encrypted secrets, the native helper, dictation coordination, and updates. |
| `src/preload/`                  | Minimal, typed APIs exposed only through `contextBridge`.                                                                                   |
| `src/renderer/`                 | Main-window React + MUI UI, i18n, state, and pure UI logic.                                                                                 |
| `src/capsule/`, `src/recorder/` | Renderer code for the floating capsule and recording windows.                                                                               |
| `native/helper/`                | Windows-native hotkey, target-window, and paste behavior.                                                                                   |
| `tests/`                        | Vitest regression tests mirroring `core`, `main`, `preload`, `renderer`, `recorder`, and `capsule`.                                         |

Follow the neighboring source convention of using `.js` output extensions in relative imports. Production code in `src/renderer/`, `src/capsule/`, and `src/recorder/` must not import Electron or Node directly; communicate through the appropriate preload API.

## Code and product constraints

- Keep TypeScript strict: accept boundary input as `unknown` and narrow it, use `import type`, and avoid `any`, unsafe assertions, and unhandled promises. Deliberate fire-and-forget work must be explicit with `void` and handle rejection at the appropriate boundary.
- Add comments only for non-obvious constraints or rationale, using one short sentence. Do not add decorative comments, comments that restate code, TODO/FIXME placeholders, redundant JSDoc, or consecutive multi-line comments.
- Reuse the established React patterns in `theme.ts`, `ui/`, `state/client.ts`, `logic/`, and `i18n/messages.ts`. Add visible strings to both locales and connect UI to real state and actions rather than static placeholders.
- Provider contract v3 separates speech recognition from text processing. When changing provider capabilities, inputs/outputs, or processing prompts, review `contracts.ts`, `pipeline.ts`, `registry.ts`, the implementation, fixtures, and tests together. Do not assume a fixed prompt or static schema.
- Automatic dictionary learning must stay local, controllable, low-interruption, and adaptive. Score confidence, category, frequency, recency, and rejection cooldown rather than hard-coding a rule such as “prompt after two occurrences”.
- When changing settings, verify the returned snapshot, the runtime side effect, and failure rollback. Hotkeys, microphone selection, provider activation, updates, and launch-at-login cannot be changed only in persisted JSON.

## Design system and UI quality

- The main renderer uses React, MUI, and Emotion through one `ThemeProvider`/`CssBaseline` entry point. Treat `src/renderer/theme.ts` as the single source of truth for color schemes, component overrides, typography, motion, and shared design tokens. Do not create a second theme, add a competing UI library, or add feature-level global CSS.
- Preserve the restrained neutral Material You direction. The canonical palette belongs in `theme.ts`; do not copy it into feature components or introduce arbitrary brand accents and one-theme-only colors.

| Role                         | Light                | Dark                               |
| ---------------------------- | -------------------- | ---------------------------------- |
| Base surface                 | `#ffffff`            | `#111111` default, `#161616` paper |
| Primary text and action      | `#111111`            | `#f5f5f5`                          |
| Secondary text               | `#6b6b6b`            | `#a3a3a3`                          |
| Divider and disabled text    | `#e5e5e5`, `#a3a3a3` | `#303030`, `#737373`               |
| Error and soft error surface | `#d92d20`, `#fef3f2` | `#f97066`, `#3b1d24`               |

- Prefer semantic MUI palette keys in `sx` and component props: `background.default`, `background.paper`, `text.primary`, `text.secondary`, `text.disabled`, `divider`, `action.hover`, `action.selected`, `primary`, and `error`. Use literal colors only for an intentional exception with a corresponding dark-scheme treatment.
- The theme uses MUI CSS variables. For derived or translucent colors, use `themePalette(currentTheme)` and `themeAlpha(color, opacity)`; for dark-only exceptions, use `currentTheme.applyStyles('dark', ...)`. Do not apply MUI `alpha()` directly to a CSS-variable palette value or hard-code a light-only translucent color.
- Reuse `tokens.duration` (160ms), `tokens.radiusCard` (24px), `tokens.radiusControl` (16px), and `tokens.radiusDialog` (28px). The theme already provides flat Paper surfaces, pill buttons and chips, 42px minimum button height, 44px outlined-input height, and 46px tab height; extend those rules before adding local radii, elevation, shadows, or timing values.
- Build from the existing MUI primitives and shared renderer UI (`Stack`, `Box`, `Paper`, `Typography`, `ui/`, and theme component overrides). Reuse `Page`, `PageHeader`, `Card`, `EmptyState`, `Field`, `SwitchField`, `HotkeyField`, `ConfirmDialog`, `useToast`, and `ProviderIcon` before creating a parallel pattern.
- Use semantic typography variants and the established system font stack. Do not add isolated font families, uppercase button text, broad decorative gradients, or custom shadows that conflict with the current system; preserve the existing narrow keycap treatment through `HotkeyField` when it applies.
- Preserve both light and dark rendering under the system color preference. Do not force a color mode or bypass the theme with a static page background. Keep surfaces flat and bordered as established by the `MuiPaper`, `MuiDialog`, input, button, and navigation overrides.
- Make layouts responsive in both width and height. Use MUI responsive values where possible, retain the existing `<700px` navigation-rail collapse and `max-height: 680px` compact layouts, and prevent horizontal overflow in pages and dialogs.
- Maintain accessible interaction: retain the global `:focus-visible` treatment and reduced-motion support, use native MUI controls, provide translated labels for icon-only actions, and give dialogs a real title and accessible relationship. Color alone must not communicate status or state.
- Put visible copy, accessible names, and interpolation strings in both `zh-CN` and `en-US` entries of `i18n/messages.ts`. Read them through `useI18n()`, preserve interpolation variables across locales, and use the active locale for dates and numbers.
- The capsule is an independent, transparent CSS surface rather than a MUI renderer. Keep its paired light/dark `--capsule-*` tokens, 4px transparent inset, focus-visible behavior, and reduced-motion rules. Do not add an oversized CSS shadow that can be clipped by the transparent BrowserWindow boundary.
- Validate meaningful UI changes in Electron. `npm.cmd run smoke` exercises desktop interactions plus a `375×812` responsive pass that checks dialog bounds and horizontal overflow; it does not replace checking the opposite system color scheme or a short-height Home layout. Visual-only browser loads or static screenshots are insufficient for renderer, capsule, or recorder claims.

## Electron, IPC, and privacy

- Keep `app.enableSandbox()` enabled. Every BrowserWindow must keep `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true`, and deny popups and arbitrary navigation. Production renderers may only come from `app://renderer`; the trusted development origin is `http://127.0.0.1:3000`.
- Define new IPC through a narrow typed contract in `src/shared/`, an explicit preload wrapper, and a main-process handler that calls `assertTrustedSender` and parses every untrusted argument. Event IPC for the capsule and recorder must also validate its `webContents.id`, session, and payload. Update handler cleanup and the channel-alignment coverage in `tests/preload/channels.test.ts`.
- Never expose API keys, tokens, audio, or transcripts through renderer snapshots, preload APIs, logs, test snapshots, or diagnostic archives. Persist credentials only in the main process with `ElectronSecretProtector`/`safeStorage`; renderers receive only configured-secret summaries.
- Diagnostics are redacted by default. Include audio attachments only when the user explicitly chooses to export them, and preserve the exclusions for text, request bodies, and secrets.
- The capsule, recorder, and main window rely on their preload bridges. A direct browser load of `capsule.html` or `recorder.html` is not valid Electron behavior verification.
- Renderers must not directly use Node, Electron, the file system, SQLite, or provider network calls. Write configuration through `ConfigurationService` and history through its repository service. Extending persisted data requires matching schema/migration, defaults, parsing, snapshots, IPC validation, and regression tests.
- Do not casually change the development address or port. `127.0.0.1:3000` constrains Vite, trusted-origin checks, recording permissions, all three HTML CSPs, and security tests; update every affected location together.

## Native helper and wire protocol

- When changing the wire protocol in `src/main/native/protocol.ts`, update `native/helper/src/protocol.h`, encoding/decoding, frame-length validation, and related tests together. Do not update only the TypeScript or C++ side.
- Do not present a native self-test, source inspection, or simulated input as complete real-world hotkey or target-window validation; state the actual scope of validation.
- Recording and provider changes must retain format, sample information, cancellation, and error propagation. Real requests, recordings, and user dictionaries are sensitive data; do not use saved credentials for external requests without explicit authorization.
- Provider URLs default to HTTPS. Allow HTTP only when the user explicitly enables it and the target is localhost or a private network; continue removing credentials, query parameters, and fragments from URLs.

## Validation and packaging

Use `npm.cmd`/`npx.cmd` for local Windows commands. Run affected tests first, then expand validation according to risk.

| Scenario                                     | Command                    |
| -------------------------------------------- | -------------------------- |
| Formatting, linting, types, tests, and build | `npm.cmd run check`        |
| Electron-layer smoke test                    | `npm.cmd run smoke`        |
| Native-helper smoke test                     | `npm.cmd run smoke:native` |
| Runnable directory package                   | `npm.cmd run package:dir`  |
| NSIS installer                               | `npm.cmd run package:win`  |

`npm.cmd run build` runs `clean` first and recursively deletes `dist/` and `release/`; `check`, `smoke`, `smoke:native`, and the packaging commands all pass through that build step. Copy or inspect deliverable artifacts before running those commands. `smoke` proves only the development Electron path; claim packaged-artifact verification only after creating and inspecting the actual installer or executable.

Preserve the `asarUnpack` and `extraResources` rules in `electron-builder.yml`: `better-sqlite3`, the application icon, and `untypo_native_helper.exe` depend on them. Native Windows builds require the Visual Studio C++ x64 workload; do not move the full build or CI verification to a non-Windows runner.

When changing CI or release behavior, keep the Windows runner, locked dependency installation, and Node 22. The release job must explicitly run `node node_modules/electron/install.js` after `npm ci`. Stable releases use `master`; `preview` releases only publish when the version changes. Inspect the current workflow's branch, tag, and release-asset logic before changing these rules.

## Git and delivery

- Run `git diff --check` after changes and stage only task-owned files. Inspect `git diff --cached` before committing. Do not version `dist/`, `build/`, `release/`, coverage, lint reports, or local secrets. Follow the repository's LF policy and avoid reformatting unrelated files.
- When changing a version, check `package.json`, `package-lock.json`, user-visible README versions, and relevant test or release assertions together.
- In handoff, list changed files, the validation actually run, and its results. Distinguish source inspection, unit tests, Electron smoke tests, native validation, and packaging validation; clearly state checks that were not run or were blocked by the environment.
