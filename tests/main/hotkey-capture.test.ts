import { describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '../../src/shared/ipc';
import {
  captureInputFromAccelerator,
  RendererHotkeyCapture,
} from '../../src/main/native/hotkey-capture';

const createContents = () => {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const contents = {
    isDestroyed: () => false,
    on: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
      const bucket = listeners.get(channel) ?? new Set();
      bucket.add(listener);
      listeners.set(channel, bucket);
      return contents;
    }),
    once: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
      const wrap = (...args: unknown[]) => {
        listeners.get(channel)?.delete(wrap);
        listener(...args);
      };
      const bucket = listeners.get(channel) ?? new Set();
      bucket.add(wrap);
      listeners.set(channel, bucket);
      return contents;
    }),
    removeListener: vi.fn(
      (channel: string, listener: (...args: unknown[]) => void) => {
        listeners.get(channel)?.delete(listener);
        return contents;
      },
    ),
    send: vi.fn(),
    emit(channel: string, ...args: unknown[]) {
      for (const listener of [...(listeners.get(channel) ?? [])]) {
        listener(...args);
      }
    },
  };
  return contents;
};

describe('captureInputFromAccelerator', () => {
  it('rebuilds a keyDown payload for the registered shortcut', () => {
    expect(captureInputFromAccelerator('Ctrl+Alt+Space')).toEqual({
      altKey: true,
      code: 'Space',
      ctrlKey: true,
      key: ' ',
      metaKey: false,
      repeat: false,
      shiftKey: false,
      type: 'keyDown',
    });
    expect(captureInputFromAccelerator('Ctrl+Shift+D')).toMatchObject({
      code: 'KeyD',
      ctrlKey: true,
      key: 'D',
      shiftKey: true,
    });
  });
});

describe('RendererHotkeyCapture', () => {
  it('prevents default and forwards physical key events to the renderer', () => {
    const contents = createContents();
    const capture = new RendererHotkeyCapture();
    capture.start(contents);
    const preventDefault = vi.fn();

    contents.emit(
      'before-input-event',
      { preventDefault },
      {
        alt: true,
        code: 'KeyD',
        control: true,
        isAutoRepeat: false,
        key: '∂',
        meta: false,
        shift: false,
        type: 'keyDown',
      },
    );

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(contents.send).toHaveBeenCalledWith(
      IPC_CHANNELS.hotkeyCaptureEvent,
      {
        altKey: true,
        code: 'KeyD',
        ctrlKey: true,
        key: '∂',
        metaKey: false,
        repeat: false,
        shiftKey: false,
        type: 'keyDown',
      },
    );
    capture.stop();
  });

  it('emits the currently registered accelerator when globalShortcut steals it', () => {
    const contents = createContents();
    const capture = new RendererHotkeyCapture();
    capture.start(contents);
    capture.emitAccelerator('Ctrl+Alt+Space');
    expect(contents.send).toHaveBeenCalledWith(
      IPC_CHANNELS.hotkeyCaptureEvent,
      captureInputFromAccelerator('Ctrl+Alt+Space'),
    );
    capture.stop();
  });
});
