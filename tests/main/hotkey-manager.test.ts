import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const globalShortcut = vi.hoisted(() => ({
  register: vi.fn(() => true),
  unregister: vi.fn(),
}));

vi.mock('electron', () => ({ globalShortcut }));

import { HotkeyManager } from '../../src/main/hotkey/hotkey-manager.js';
import { parseHotkeyAccelerator } from '../../src/main/native/hotkey.js';
import { NativeHotkeyAction } from '../../src/main/native/protocol.js';
import type { ConfigurationService } from '../../src/main/storage/config-store.js';
import type { NativeHelperClient } from '../../src/main/native/client.js';
import { createStoredConfig } from './fixtures.js';

const savedAccelerator = 'Ctrl+Alt+Space';
const alternateAccelerator = 'Alt+F12';

const createManager = (overrides?: { onAction?: (action: NativeHotkeyAction) => void }) => {
  const load = vi.fn(() => createStoredConfig());
  const configuration = { load } as unknown as ConfigurationService;
  const diagnostics = {
    log: vi.fn(),
    recordIssue: vi.fn(),
  };
  const configureHotkey = vi.fn(() => undefined);
  let nativeListener: ((action: NativeHotkeyAction) => void) | undefined;
  const onHotkey = vi.fn((listener: (action: NativeHotkeyAction) => void) => {
    nativeListener = listener;
    return () => {
      nativeListener = undefined;
    };
  });
  const native = {
    configureHotkey,
    onHotkey,
  } as unknown as NativeHelperClient;
  const onAction = overrides?.onAction ?? vi.fn();
  const manager = new HotkeyManager({
    configuration,
    diagnostics,
    native,
    onAction,
  });
  return {
    configureHotkey,
    diagnostics,
    load,
    manager,
    nativeListener: () => nativeListener,
  };
};

describe('HotkeyManager', () => {
  beforeEach(() => {
    vi.stubGlobal('process', { ...process, platform: 'win32' });
    globalShortcut.register.mockClear();
    globalShortcut.unregister.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('configures the native hotkey for a valid accelerator', async () => {
    const { configureHotkey, diagnostics, manager } = createManager();

    await manager.apply(savedAccelerator);

    expect(configureHotkey).toHaveBeenCalledTimes(1);
    expect(diagnostics.log).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Native hotkey configured',
        scope: 'hotkey.configuration',
      }),
    );
  });

  it('defers a changed accelerator while capture is active', async () => {
    const { configureHotkey, manager } = createManager();

    await manager.setCaptureActive(true);
    await manager.apply(alternateAccelerator);
    expect(configureHotkey).not.toHaveBeenCalled();

    await manager.setCaptureActive(false);
    expect(configureHotkey).toHaveBeenCalledTimes(1);
  });

  it('re-applies the saved accelerator when capture ends without changes', async () => {
    const { configureHotkey, manager } = createManager();

    await manager.setCaptureActive(true);
    await manager.setCaptureActive(false);

    expect(configureHotkey).toHaveBeenCalledWith(parseHotkeyAccelerator(savedAccelerator));
  });

  it('rolls back to the saved accelerator when resuming fails', async () => {
    const { configureHotkey, diagnostics, load, manager } = createManager();
    vi.mocked(configureHotkey)
      .mockRejectedValueOnce(new Error('unavailable'))
      .mockResolvedValue(undefined);
    await manager.setCaptureActive(true);
    await manager.apply(alternateAccelerator);

    await expect(manager.setCaptureActive(false)).rejects.toThrow('unavailable');

    expect(configureHotkey).toHaveBeenCalledTimes(2);
    expect(diagnostics.recordIssue).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'hotkey.capture-resume' }),
    );
    expect(load).toHaveBeenCalled();
  });

  it('forwards native hotkey events unless capture is active', async () => {
    const onAction = vi.fn();
    const { manager, nativeListener } = createManager({ onAction });

    manager.start();
    nativeListener()?.(NativeHotkeyAction.Toggle);
    expect(onAction).toHaveBeenCalledTimes(1);

    await manager.setCaptureActive(true);
    nativeListener()?.(NativeHotkeyAction.Toggle);
    expect(onAction).toHaveBeenCalledTimes(1);
    manager.stop();
  });

  it('stops dispatching after the native listener is removed', () => {
    const onAction = vi.fn();
    const { manager, nativeListener } = createManager({ onAction });

    manager.start();
    manager.stop();
    nativeListener()?.(NativeHotkeyAction.Toggle);
    expect(onAction).not.toHaveBeenCalled();
  });
});
