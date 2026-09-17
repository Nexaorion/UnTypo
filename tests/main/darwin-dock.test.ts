import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('macOS Dock running indicator', () => {
  it('does not transform UnTypo into a UIElement when pinning the capsule', async () => {
    const source = await readFile('src/main/capsule/capsule-window.ts', 'utf8');
    expect(source).toContain('skipTransformProcessType: true');
    expect(source).toContain('visibleOnFullScreen: true');
  });

  it('restores a regular Dock icon after the main window is hidden', async () => {
    const source = await readFile('src/main/index.ts', 'utf8');
    expect(source).toContain("app.setActivationPolicy('regular')");
    const hideWindow = source.indexOf('window.hide();');
    const restoreDock = source.indexOf('keepDarwinDockVisible();', hideWindow);
    expect(hideWindow).toBeGreaterThan(-1);
    expect(restoreDock).toBeGreaterThan(hideWindow);
  });
});
