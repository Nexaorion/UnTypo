# UnTypo

UnTypo is an open-source Windows client for AI-assisted dictation, translation,
and instruction-driven text generation.

The current client foundation contains the Electron runtime, sandboxed preload
bridges, in-memory recorder, authenticated C++ Native Helper, provider pipeline,
encrypted configuration, SQLite text history, tray runtime, fallback result
capsule, and a UI component preview. Product frontend pages are intentionally
outside this stage.

## Development

Requirements:

- Node.js 22.12 or newer
- npm 9 or newer
- Visual Studio with the Desktop development with C++ workload

Install dependencies and start the Electron development runtime:

```powershell
npm ci
npm run dev
```

Run the verification suite:

```powershell
npm run check
npm run smoke
```

`npm run check` verifies formatting, lint, types, unit and Provider contract
tests, renderer assets, and the C++ Helper build. `npm run smoke` additionally
starts Electron and exercises the sandboxed renderer, recorder bridge,
authenticated Native Helper pipe, and preview component interactions.

## Renderer backend API

The sandboxed preload exposes a typed `window.untypo` API for the future product
frontend. It can read a sanitized client snapshot, update general and dictation
settings, manage the dictionary and encrypted personal profile, add/test/remove
Provider profiles, and list or clear text history. Provider snapshots include
configured secret field names but never return decrypted secret values.

All payloads are validated again in Main before they reach storage or runtime
services. See `src/shared/ipc.ts` for the frontend contract and
`src/main/ipc/client-controller.ts` for the trusted Main-process boundary.

Build an unpacked Windows application or an NSIS installer:

```powershell
npm run package:dir
npm run package:win
```

## Release verification

The Windows installer is intentionally unsigned during the initial release
stage, so Windows may display an unknown-publisher warning. GitHub Actions emits
the installer with `SHA256SUMS.txt`; verify it before running the installer:

```powershell
Get-FileHash .\UnTypo-0.1.0-x64.exe -Algorithm SHA256
Get-Content .\SHA256SUMS.txt
```

Only use an installer whose computed SHA-256 value matches the published value.
The workflow keeps packaging isolated in a dedicated step so code signing can be
added when a certificate is available.
