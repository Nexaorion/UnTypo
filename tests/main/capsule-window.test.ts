import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CAPSULE_CHANNELS } from '../../src/shared/capsule-ipc';

const electronMocks = vi.hoisted(() => {
  const handlers = new Map<string, (...arguments_: unknown[]) => void>();
  const windows: Array<Record<string, unknown>> = [];
  const clipboard = { writeText: vi.fn() };
  const ipcMain = {
    on: vi.fn(
      (channel: string, handler: (...arguments_: unknown[]) => void) => {
        handlers.set(channel, handler);
      },
    ),
    removeListener: vi.fn(),
  };
  const screen = {
    getCursorScreenPoint: vi.fn(() => ({ x: 100, y: 100 })),
    getDisplayNearestPoint: vi.fn(() => ({
      workArea: { height: 1080, width: 1920, x: 0, y: 0 },
    })),
  };
  const BrowserWindow = vi.fn(function BrowserWindowMock() {
    let destroyed = false;
    let visible = false;
    let closedHandler: (() => void) | undefined;
    const window = {
      destroy: vi.fn(() => {
        if (destroyed) return;
        destroyed = true;
        closedHandler?.();
      }),
      isDestroyed: vi.fn(() => destroyed),
      isVisible: vi.fn(() => visible),
      loadURL: vi.fn(() => Promise.resolve()),
      once: vi.fn((event: string, handler: () => void) => {
        if (event === 'closed') closedHandler = handler;
      }),
      setAlwaysOnTop: vi.fn(),
      setIgnoreMouseEvents: vi.fn(),
      setPosition: vi.fn(),
      setSize: vi.fn(),
      setVisibleOnAllWorkspaces: vi.fn(),
      showInactive: vi.fn(() => {
        visible = true;
      }),
      webContents: {
        id: 77,
        on: vi.fn(),
        send: vi.fn(),
        setWindowOpenHandler: vi.fn(),
      },
    };
    windows.push(window);
    return window;
  });
  return { BrowserWindow, clipboard, handlers, ipcMain, screen, windows };
});

vi.mock('electron', () => ({
  BrowserWindow: electronMocks.BrowserWindow,
  clipboard: electronMocks.clipboard,
  ipcMain: electronMocks.ipcMain,
  screen: electronMocks.screen,
}));

import { CapsuleWindowController } from '../../src/main/capsule/capsule-window';

const event = { sender: { id: 77 } };

describe('CapsuleWindowController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    electronMocks.BrowserWindow.mockClear();
    electronMocks.clipboard.writeText.mockClear();
    electronMocks.handlers.clear();
    electronMocks.ipcMain.on.mockClear();
    electronMocks.ipcMain.removeListener.mockClear();
    electronMocks.windows.length = 0;
  });

  it('reuses one window through recording, processing, and success', async () => {
    const controller = new CapsuleWindowController();

    await controller.showRecording('zh-CN');
    const window = electronMocks.windows[0] as {
      destroy: ReturnType<typeof vi.fn>;
      setSize: ReturnType<typeof vi.fn>;
      webContents: { send: ReturnType<typeof vi.fn> };
    };
    electronMocks.handlers.get(CAPSULE_CHANNELS.ready)?.(event);
    controller.updateLevel(0.55);
    await controller.showProcessing('zh-CN');
    await controller.showSuccess(
      { intent: 'transcription', outputText: '转写结果' },
      'inserted',
      'zh-CN',
    );

    expect(electronMocks.BrowserWindow).toHaveBeenCalledTimes(1);
    expect(window.setSize).toHaveBeenNthCalledWith(1, 276, 56, false);
    expect(window.setSize).toHaveBeenLastCalledWith(540, 68, false);
    expect(window.webContents.send).toHaveBeenCalledWith(
      CAPSULE_CHANNELS.update,
      expect.objectContaining({ level: 0.55, type: 'recording' }),
    );
    expect(window.webContents.send).toHaveBeenLastCalledWith(
      CAPSULE_CHANNELS.update,
      expect.objectContaining({
        delivery: 'inserted',
        outputText: '转写结果',
        type: 'success',
      }),
    );

    await vi.advanceTimersByTimeAsync(10_000);
    expect(window.destroy).toHaveBeenCalledOnce();
    controller.destroy();
  });

  it('does not auto-close recording or processing states', async () => {
    const controller = new CapsuleWindowController();
    await controller.showRecording('en-US');
    const window = electronMocks.windows[0] as {
      destroy: ReturnType<typeof vi.fn>;
    };

    await vi.advanceTimersByTimeAsync(30_000);
    expect(window.destroy).not.toHaveBeenCalled();
    await controller.showProcessing('en-US');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(window.destroy).not.toHaveBeenCalled();
    controller.destroy();
  });

  it('only copies terminal success text from the expected renderer', async () => {
    const controller = new CapsuleWindowController();
    await controller.showRecording('en-US');
    electronMocks.handlers.get(CAPSULE_CHANNELS.copy)?.(event);
    expect(electronMocks.clipboard.writeText).not.toHaveBeenCalled();

    await controller.showSuccess(
      { intent: 'translation', outputText: 'Copied result' },
      'copy',
      'en-US',
    );
    electronMocks.handlers.get(CAPSULE_CHANNELS.copy)?.(event);

    expect(electronMocks.clipboard.writeText).toHaveBeenCalledWith(
      'Copied result',
    );
    controller.destroy();
  });
});
