# UnTypo Development Guide

## Project boundaries

UnTypo is a local-first dictation client for Windows x64 and macOS arm64, built with Electron, React, strict TypeScript, and a C++ native helper. It requires Node `>=22.12` and npm `>=9`. Configuration, history, and BYOK credentials are user-local data; current source and tests are the authority on implemented behavior.

Before working, run `git status --short` and inspect the affected code and adjacent tests. Preserve unrelated changes made by the user or other tasks. Do not commit, push, publish, reset, or clean the working tree unless explicitly asked.

For a settings control, switch, or action that looks functional but is ineffective, trace the complete path: Renderer → shared contract → preload → IPC validation and trusted sender → main runtime → persistence and runtime side effect. A UI-only change does not prove the behavior is fixed.

## Directory ownership

| Path                            | Responsibility                                                                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/core/providers/`           | Electron-independent speech/text provider contracts, pipelines, registries, and implementations.                                            |
| `src/shared/`                   | Cross-process types, IPC channels, and recording/diagnostics contracts.                                                                     |
| `src/main/`                     | Electron lifecycle, windows, trusted IPC, configuration/history, encrypted secrets, the native helper, dictation coordination, and updates. |
| `src/main/core-services/`       | Core runtime services (permissions, hotkeys, tray, menu, window management) extracted from desktop-runtime.                                 |
| `src/main/lifecycle/`           | Application bootstrap, shutdown, and error handling orchestration.                                                                          |
| `src/main/storage/`             | Data access layer: repositories (config, history, dictionary), cache manager, and encryption services.                                      |
| `src/main/ipc/`                 | IPC controllers, middleware (auth, validation, rate-limit), and route registry.                                                             |
| `src/main/utils/`               | Shared utilities: structured logger, performance monitor, error codes.                                                                      |
| `src/preload/`                  | Minimal, typed APIs exposed only through `contextBridge`.                                                                                   |
| `src/renderer/`                 | Main-window React + MUI UI, i18n, state, and pure UI logic.                                                                                 |
| `src/status-overlay/`, `src/recorder/` | Renderer code for the floating status overlay and recording windows.                                                                               |
| `native/helper/`                | Native hotkey, target-window, and paste behavior (Win32 and macOS).                                                                         |
| `tests/`                        | Vitest regression tests mirroring `core`, `main`, `preload`, `renderer`, `recorder`, and `status-overlay`.                                         |

Follow the neighboring source convention of using `.js` output extensions in relative imports. Production code in `src/renderer/`, `src/status-overlay/`, and `src/recorder/` must not import Electron or Node directly; communicate through the appropriate preload API.

## Architecture principles

### Dependency injection and service lifecycle

- Use `inversify` for dependency injection in the main process. Services are registered in `src/main/container.ts` and resolved through constructor injection with `@injectable()` and `@inject()` decorators.
- Prefer constructor injection over property injection. Use `@inject('ServiceName')` for string tokens and direct class types when unambiguous.
- Services follow a consistent lifecycle: construct → initialize → start → stop → dispose. Long-running services implement `IService` interface with `start()` and `stop()` methods.
- Avoid circular dependencies by extracting shared contracts to `src/shared/` or using interface-based injection with factory patterns.

### Repository pattern for data access

- All data persistence (SQLite, encrypted secrets, file system) goes through repository classes in `src/main/storage/repositories/`.
- Repositories provide a clean API (`get`, `set`, `query`, `delete`) and handle caching, transactions, and error recovery internally.
- Use prepared statements for all SQLite queries. Batch inserts must use transactions. Create indexes for frequently queried columns.
- Cache frequently accessed data (config snapshots, permission checks) through `CacheManager` with explicit TTL values.

### IPC middleware and validation

- All IPC handlers are registered through `IpcRegistry` with middleware support (authentication, validation, rate limiting).
- Use `zod` schemas to validate all IPC inputs at runtime. Define schemas in `src/shared/` alongside the type definitions.
- IPC handlers receive validated data with full type safety. The middleware chain ensures sender trust before handler execution.
- Rate-limit high-frequency IPC channels (recording events, real-time status) to prevent renderer abuse.

### Structured logging and observability

- Use `pino` for all logging. Import the shared `logger` from `src/main/utils/logger.ts`.
- Log at appropriate levels: `debug` for trace information, `info` for lifecycle events, `warn` for recoverable issues, `error` for failures, `fatal` for unrecoverable errors.
- Include structured context in logs: `logger.info({ userId, duration }, 'Action completed')`. Never log secrets, tokens, or PII.
- Use performance markers for critical paths: `const start = performance.now()` → log duration on completion.

## Code and product constraints

- Keep TypeScript strict: accept boundary input as `unknown` and narrow it, use `import type`, and avoid `any`, unsafe assertions, and unhandled promises. Deliberate fire-and-forget work must be explicit with `void` and handle rejection at the appropriate boundary.
- Add comments only for non-obvious constraints or rationale, using one short sentence. Do not add decorative comments, comments that restate code, TODO/FIXME placeholders, redundant JSDoc, or consecutive multi-line comments.
- Reuse the established React patterns in `theme.ts`, `ui/`, `store/client.ts`, `helpers/`, and `i18n/messages.ts`. Add visible strings to both locales and connect UI to real state and actions rather than static placeholders.
- Provider contract v3 separates speech recognition from text processing. When changing provider capabilities, inputs/outputs, or processing prompts, review `types.ts`, `pipeline.ts`, `registry.ts`, the implementation, fixtures, and tests together. Do not assume a fixed prompt or static schema.
- Automatic dictionary learning must stay local, controllable, low-interruption, and adaptive. Score confidence, category, frequency, recency, and rejection cooldown rather than hard-coding a rule such as "prompt after two occurrences".
- When changing settings, verify the returned snapshot, the runtime side effect, and failure rollback. Hotkeys, microphone selection, provider activation, updates, and launch-at-login cannot be changed only in persisted JSON.

## Naming and style conventions

### File naming

- Use `kebab-case.ts` for multi-word files, `single.ts` for single-word files.
- Suffix files by role: `*-service.ts`, `*-repository.ts`, `*-controller.ts`, `*-middleware.ts`.
- React components use `.tsx` extension. Type-only files use `types.ts` suffix.

### Code naming

- **Interfaces and types**: `PascalCase`, no `I` prefix. Example: `UserConfig`, `ProviderOptions`.
- **Classes**: `PascalCase`. Example: `ConfigRepository`, `DictationCoordinator`.
- **Functions and methods**: `camelCase`, verb prefix. Example: `createWindow()`, `async fetchUserData()`.
- **Variables**: `camelCase`. Constants: `SCREAMING_SNAKE_CASE` for module-level only.
- **Private members**: `camelCase` with `private` keyword, no underscore prefix.
- **Generic parameters**: Single letter (`T`, `K`, `V`) or `PascalCase` (`TInput`, `TOutput`).

### Import order (enforced by ESLint)

1. Node built-ins (`node:fs`, `node:path`)
2. External dependencies (`electron`, `inversify`)
3. Project absolute paths (`../../shared/`, `../../core/`)
4. Relative paths (`../utils/`, `./types.ts`)
5. Type-only imports (`import type { ... }`)

### Comment discipline

- Write comments to explain **why**, not **what**. Code structure and names should make the "what" obvious.
- Good: `// Retry with exponential backoff to handle transient network errors`
- Avoid: `// Get the user name` (redundant with code)
- Avoid: `TODO`, `FIXME`, `HACK` comments. Use GitHub Issues for tracking work.
- Avoid JSDoc for TypeScript code; types and names are self-documenting.

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
- The status overlay is an independent, transparent CSS surface rather than a MUI renderer. Keep its paired light/dark `--capsule-*` tokens, 4px transparent inset, focus-visible behavior, and reduced-motion rules. Do not add an oversized CSS shadow that can be clipped by the transparent BrowserWindow boundary.
- Validate meaningful UI changes in Electron. `npm.cmd run smoke` exercises desktop interactions plus a `375×812` responsive pass that checks dialog bounds and horizontal overflow; it does not replace checking the opposite system color scheme or a short-height Home layout. Visual-only browser loads or static screenshots are insufficient for renderer, status-overlay, or recorder claims.

## Electron, IPC, and privacy

- Keep `app.enableSandbox()` enabled. Every BrowserWindow must keep `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true`, and deny popups and arbitrary navigation. Production renderers may only come from `app://renderer`; the trusted development origin is `http://127.0.0.1:3000`.
- Define new IPC through a narrow typed contract in `src/shared/`, an explicit preload wrapper, and a main-process handler that calls `assertTrustedSender` and parses every untrusted argument. Event IPC for the status overlay and recorder must also validate its `webContents.id`, session, and payload. Update handler cleanup and the channel-alignment coverage in `tests/preload/channels.test.ts`.
- Register all IPC handlers through `IpcRegistry.register()` with zod schema validation. The registry applies authentication and validation middleware automatically.
- Never expose API keys, tokens, audio, or transcripts through renderer snapshots, preload APIs, logs, test snapshots, or diagnostic archives. Persist credentials only in the main process with `ElectronSecretProtector`/`safeStorage` (in `src/main/storage/keychain.ts`); renderers receive only configured-secret summaries.
- Diagnostics are redacted by default. Include audio attachments only when the user explicitly chooses to export them, and preserve the exclusions for text, request bodies, and secrets.
- The status overlay, recorder, and main window rely on their preload bridges. A direct browser load of `status-overlay.html` or `recorder.html` is not valid Electron behavior verification.
- Renderers must not directly use Node, Electron, the file system, SQLite, or provider network calls. Write configuration through `ConfigurationService` (in `src/main/storage/config-store.ts`) and history through its repository service. Extending persisted data requires matching schema/migration, defaults, parsing, snapshots, IPC validation, and regression tests.
- Do not casually change the development address or port. `127.0.0.1:3000` constrains Vite, trusted-origin checks, recording permissions, all three HTML CSPs, and security tests; update every affected location together.

## Performance optimization guidelines

### Main process optimization

- Use lazy initialization for non-critical services. Defer sync service, update checks, and diagnostic collection until after main window creation.
- Batch IPC calls when possible. Prefer one `getSnapshot()` call over multiple granular getters.
- Profile main process startup with `performance.now()` markers. Target <1000ms from `app.ready` to main window visible.
- Use `setImmediate()` to yield to event loop for long-running synchronous operations.

### Database optimization

- Create indexes for all frequently queried columns: `created_at`, `provider`, `user_id`.
- Use prepared statements for all queries. Reuse statement objects across multiple executions.
- Wrap bulk inserts (>10 records) in explicit transactions: `db.transaction(() => { ... })`.
- Set pragmas for performance: `PRAGMA journal_mode = WAL`, `PRAGMA synchronous = NORMAL`.
- Implement pagination for history queries. Never load all records into memory.

### Caching strategy

- Cache expensive operations: permission checks (60s TTL), config snapshots (30s TTL), provider registries (indefinite).
- Use `CacheManager` with explicit TTL and size limits. Monitor cache hit rate in logs.
- Invalidate cache entries explicitly on updates: `cache.delete(key)` after config changes.
- Do not cache user-sensitive data (credentials, audio, transcripts) or frequently changing state (recording status).

### Network optimization

- Reuse HTTP connections with `keepAlive: true` agent configuration.
- Implement retry logic with exponential backoff for transient failures (408, 429, 5xx).
- Stream large responses (audio uploads, provider streaming) instead of buffering in memory.
- Set appropriate timeouts: 30s for provider requests, 60s for sync operations.
- Monitor network latency and log slow requests (>1000ms) for debugging.

## Native helper and wire protocol

- When changing the wire protocol in `src/main/native/protocol.ts`, update `native/helper/src/protocol.h`, encoding/decoding, frame-length validation, the Windows and macOS helper implementations, and related tests together. Do not update only the TypeScript or C++ side.
- Do not present a native self-test, source inspection, or simulated input as complete real-world hotkey or target-window validation; state the actual scope of validation.
- Recording and provider changes must retain format, sample information, cancellation, and error propagation. Real requests, recordings, and user dictionaries are sensitive data; do not use saved credentials for external requests without explicit authorization.
- Provider URLs default to HTTPS. Allow HTTP only when the user explicitly enables it and the target is localhost or a private network; continue removing credentials, query parameters, and fragments from URLs.

## Error handling and diagnostics

### Error types and codes

- Define error codes in `src/main/utils/error-codes.ts` grouped by category (1xxx config, 2xxx permission, 3xxx provider, 4xxx storage).
- Use custom `UnTypoError` class with code, message, and optional context object.
- Catch errors at service boundaries and log with appropriate context: `logger.error({ err, context }, 'Operation failed')`.

### Diagnostic collection

- Record uncaught exceptions and unhandled rejections through `DiagnosticCollector`.
- Include stack traces, error codes, and sanitized context (no secrets, PII, or audio).
- Export diagnostics only on explicit user action. Redact sensitive fields by default.

### Graceful degradation

- Fallback to safe defaults when non-critical services fail (sync, updates, tray).
- Surface errors to user only when action is required (permission denied, provider misconfigured).
- Log all errors for post-mortem debugging, even when handled gracefully.

## Testing strategy

### Unit tests

- Test business logic in isolation using dependency injection and mocks.
- Cover edge cases: empty inputs, malformed data, network failures, permission denied.
- Use Vitest's `describe`, `it`, `expect` structure. Group related tests in describe blocks.
- Aim for 70%+ coverage on core services, repositories, and business logic.

### Integration tests

- Test IPC flows end-to-end: renderer → preload → main → repository → database.
- Verify permission checks, validation middleware, and error handling.
- Use in-memory databases for faster test execution.

### Performance tests

- Benchmark critical operations: database inserts, history queries, provider requests.
- Assert performance requirements: <100ms for bulk insert, <10ms for indexed queries.
- Run performance tests in CI to detect regressions.

### Smoke tests

- `npm run smoke` validates Electron integration, window lifecycle, and responsive layouts.
- `npm run smoke:native` validates native helper protocol and platform-specific behavior.
- Run smoke tests before every commit that touches main process, IPC, or native code.

## Validation and packaging

Use `npm.cmd`/`npx.cmd` for local Windows commands and `npm`/`npx` on macOS. Run affected tests first, then expand validation according to risk.

| Scenario                                     | Command                   |
| -------------------------------------------- | ------------------------- |
| Formatting, linting, types, tests, and build | `npm run check`           |
| Electron-layer smoke test                    | `npm run smoke`           |
| Native-helper smoke test                     | `npm run smoke:native`    |
| Runnable directory package (Windows)         | `npm run package:dir`     |
| NSIS installer                               | `npm run package:win`     |
| Runnable directory package (macOS arm64)     | `npm run package:dir:mac` |
| Local unsigned macOS DMG + zip               | `npm run package:mac`     |

`npm run build` runs `clean` first and recursively deletes `dist/` and `release/`; `check`, `smoke`, `smoke:native`, and the packaging commands all pass through that build step.
Copy or inspect deliverable artifacts before running those commands.
`smoke` proves only the development Electron path; claim packaged-artifact verification only after creating and inspecting the actual installer or executable.

Preserve the `asarUnpack` and `extraResources` rules in `electron-builder.yml`: `better-sqlite3`, the application icon, and the platform native helper depend on them.
Native Windows builds require the Visual Studio C++ x64 workload.
Native macOS builds require CMake and the Xcode command-line tools, and produce `build/Release/untypo_native_helper` for arm64.
Do not cross-compile Windows packages on macOS or macOS packages on Windows.

Local `package:mac` stays unsigned (`identity: null`, `CSC_IDENTITY_AUTO_DISCOVERY=false`).
Signed macOS distribution is CI-only: `publish-macos-release` on `macos-15` imports a Developer ID from repository secrets, notarizes, staples, and uploads the arm64 DMG, ZIP, `latest-mac.yml`, and ZIP blockmap to the same GitHub Release as Windows.
Do not require a GitHub Environment approval for that job.
Do not put `.p12` / `.p8` files or signing passwords in the repository.
macOS auto-update is supported via `darwin_arm64` Hazel route and signed ZIP with `latest-mac.yml` metadata.

When changing CI or release behavior, keep the Windows runner for NSIS publishing, keep macOS verification on `macos-latest` without publishing, and keep signed macOS publishing on `macos-15` using repository secrets so any `master` / version-changing `preview` push can ship without a manual GitHub approval.
Use locked dependency installation and Node 22.
The Windows and macOS release jobs must explicitly run `node node_modules/electron/install.js` after `npm ci`.
Every checkout uses `persist-credentials: false`, so a release job cannot push a branch or tag with `git`; write refs through the GitHub API with `GH_TOKEN` instead.
Stable releases use `master`; `preview` releases only publish when the version changes.
Inspect the current workflow's branch, tag, and release-asset logic before changing these rules.

## Refactoring and migration guidelines

### When refactoring large files

- Extract cohesive responsibilities into separate service classes.
- Use dependency injection to manage service dependencies.
- Preserve existing tests and ensure they pass with the new structure.
- Update directory ownership table in this file when creating new directories.

### When adding dependencies

- Justify the addition: does it solve a real problem better than existing code?
- Prefer zero-dependency packages and avoid pulling in large dependency trees.
- Check license compatibility (MIT, Apache 2.0, BSD preferred).
- Update `package.json`, run `npm install`, and commit the lock file.

### When deprecating code

- Mark as deprecated in JSDoc: `@deprecated Use NewClass instead`.
- Provide migration path in comments or separate migration guide.
- Remove deprecated code in next major version, not immediately.

### Backward compatibility

- Maintain config file schema compatibility or provide migration scripts.
- Version database schema and implement incremental migrations.
- Keep IPC contracts stable; add new channels rather than breaking existing ones.

## Git and delivery

- Run `git diff --check` after changes and stage only task-owned files. Inspect `git diff --cached` before committing. Do not version `dist/`, `build/`, `release/`, coverage, lint reports, or local secrets. Follow the repository's LF policy and avoid reformatting unrelated files.
- When changing a version, check `package.json`, `package-lock.json`, user-visible README versions, and relevant test or release assertions together.
- In handoff, list changed files, the validation actually run, and its results. Distinguish source inspection, unit tests, Electron smoke tests, native validation, and packaging validation; clearly state checks that were not run or were blocked by the environment.
- Do not add AI attribution (`Co-Authored-By: Claude`, `Generated with ...`) to commits, PRs, or code comments unless explicitly requested.

## Related documentation

- **Backend refactor plan**: See `/data/UnTypo-Refactor-Plan.md` for detailed refactoring strategy, dependency choices, and migration roadmap.
- **Provider contracts**: Read `src/core/providers/types.ts` for speech/text provider interface definitions.
- **IPC channels**: Read `src/shared/client-ipc.ts` for complete IPC contract definitions.
- **Theme system**: Read `src/renderer/theme.ts` for design tokens and color palette.
- **Testing**: Read `tests/README.md` (if exists) for testing patterns and fixtures.
