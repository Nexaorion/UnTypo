import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('single application instance', () => {
  it('claims an Electron single-instance lock before starting', async () => {
    const source = await readFile('src/main/index.ts', 'utf8');
    expect(source).toContain('isSmokeTest || app.requestSingleInstanceLock()');
    expect(source).toContain("app.on('second-instance'");
    expect(source).toContain('if (!isPrimaryInstance)');
  });

  it('tells Launch Services not to open a second macOS instance', async () => {
    const source = await readFile('electron-builder.yml', 'utf8');
    expect(source).toMatch(/LSMultipleInstancesProhibited:\s*true/u);
  });

  it('does not create the main window until client IPC handlers exist', async () => {
    const source = await readFile('src/main/index.ts', 'utf8');
    const ipcReady = source.indexOf('clientIpc = new ClientIpcController(runtime)');
    const releaseGate = source.indexOf('settleMainIpcReady();', ipcReady);
    const openWindow = source.indexOf('await ensureMainWindow();', releaseGate);
    expect(source).toContain('await whenMainIpcReady');
    expect(ipcReady).toBeGreaterThan(-1);
    expect(releaseGate).toBeGreaterThan(ipcReady);
    expect(openWindow).toBeGreaterThan(releaseGate);
  });
});
