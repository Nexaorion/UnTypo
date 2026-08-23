# UnTypo

UnTypo is an open-source Windows client for AI-assisted dictation, translation,
and instruction-driven text generation.

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

Build an unpacked Windows application or an NSIS installer:

```powershell
npm run package:dir
npm run package:win
```
