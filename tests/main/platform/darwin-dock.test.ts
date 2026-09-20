import { readFile } from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const electronMocks = vi.hoisted(() => {
  const app: {
    dock: { show: ReturnType<typeof vi.fn> } | undefined;
    setActivationPolicy: ReturnType<typeof vi.fn>;
  } = {
    dock: {
      show: vi.fn(() => Promise.resolve()),
    },
    setActivationPolicy: vi.fn(),
  };
  return { app };
});

vi.mock('electron', () => ({
  app: electronMocks.app,
}));

import {
  hideMainWindowOnClose,
  keepDarwinDockVisible,
} from '../../../src/main/platform/darwin-dock';

describe('keepDarwinDockVisible', () => {
  beforeEach(() => {
    electronMocks.app.dock = {
      show: vi.fn(() => Promise.resolve()),
    };
    electronMocks.app.setActivationPolicy.mockReset();
  });

  it('shows a regular Dock icon after Darwin startup', () => {
    keepDarwinDockVisible({ isQuitting: false, platform: 'darwin' });
    expect(electronMocks.app.setActivationPolicy).toHaveBeenCalledWith('regular');
    expect(electronMocks.app.dock?.show).toHaveBeenCalledTimes(1);
  });

  it('does not change Dock policy on Windows', () => {
    keepDarwinDockVisible({ isQuitting: false, platform: 'win32' });
    expect(electronMocks.app.setActivationPolicy).not.toHaveBeenCalled();
    expect(electronMocks.app.dock?.show).not.toHaveBeenCalled();
  });

  it('does not restore the Dock while quitting', () => {
    keepDarwinDockVisible({ isQuitting: true, platform: 'darwin' });
    expect(electronMocks.app.setActivationPolicy).not.toHaveBeenCalled();
    expect(electronMocks.app.dock?.show).not.toHaveBeenCalled();
  });

  it('keeps a regular activation policy when the Dock API is missing', () => {
    electronMocks.app.dock = undefined;
    keepDarwinDockVisible({ isQuitting: false, platform: 'darwin' });
    expect(electronMocks.app.setActivationPolicy).toHaveBeenCalledWith('regular');
  });
});

describe('hideMainWindowOnClose', () => {
  const createCloseTarget = () => ({
    event: { preventDefault: vi.fn() },
    window: { hide: vi.fn() },
  });

  beforeEach(() => {
    electronMocks.app.dock = {
      show: vi.fn(() => Promise.resolve()),
    };
    electronMocks.app.setActivationPolicy.mockReset();
  });

  it('hides the window and restores the Darwin Dock', () => {
    const { event, window } = createCloseTarget();
    hideMainWindowOnClose(event, window, {
      isQuitting: false,
      isSmokeTest: false,
      platform: 'darwin',
    });
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(window.hide).toHaveBeenCalledTimes(1);
    expect(electronMocks.app.setActivationPolicy).toHaveBeenCalledWith('regular');
    expect(electronMocks.app.dock?.show).toHaveBeenCalledTimes(1);
  });

  it('hides the window on Windows without touching Dock APIs', () => {
    const { event, window } = createCloseTarget();
    hideMainWindowOnClose(event, window, {
      isQuitting: false,
      isSmokeTest: false,
      platform: 'win32',
    });
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(window.hide).toHaveBeenCalledTimes(1);
    expect(electronMocks.app.setActivationPolicy).not.toHaveBeenCalled();
    expect(electronMocks.app.dock?.show).not.toHaveBeenCalled();
  });

  it('lets a real quit close the window', () => {
    const { event, window } = createCloseTarget();
    hideMainWindowOnClose(event, window, {
      isQuitting: true,
      isSmokeTest: false,
      platform: 'darwin',
    });
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(window.hide).not.toHaveBeenCalled();
    expect(electronMocks.app.setActivationPolicy).not.toHaveBeenCalled();
    expect(electronMocks.app.dock?.show).not.toHaveBeenCalled();
  });

  it('lets the smoke test destroy the window', () => {
    const { event, window } = createCloseTarget();
    hideMainWindowOnClose(event, window, {
      isQuitting: false,
      isSmokeTest: true,
      platform: 'darwin',
    });
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(window.hide).not.toHaveBeenCalled();
    expect(electronMocks.app.setActivationPolicy).not.toHaveBeenCalled();
    expect(electronMocks.app.dock?.show).not.toHaveBeenCalled();
  });
});

describe('main process Dock callers', () => {
  it('restores the Dock after runtime start and on a non-quit close', async () => {
    const source = await readFile('src/main/index.ts', 'utf8');
    const startRuntime = source.indexOf('await runtime.start();');
    const restoreAfterStart = source.indexOf(
      'keepDarwinDockVisible({ isQuitting });',
      startRuntime,
    );
    expect(startRuntime).toBeGreaterThan(-1);
    expect(restoreAfterStart).toBeGreaterThan(startRuntime);
    expect(source).toContain('hideMainWindowOnClose(event, window, { isQuitting, isSmokeTest })');
  });
});
