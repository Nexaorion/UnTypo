import { IPC_CHANNELS, type HotkeyCaptureInput } from '../../shared/ipc.js';

export type HotkeyCaptureTarget = {
  isDestroyed: () => boolean;
  on(
    event: 'before-input-event',
    listener: (event: Electron.Event, input: Electron.Input) => void,
  ): unknown;
  once(event: 'destroyed', listener: () => void): unknown;
  removeListener(event: string, listener: (...args: never[]) => void): unknown;
  send(channel: string, payload: HotkeyCaptureInput): void;
};

const acceleratorKeyCode = (key: string): string => {
  if (key === 'Space') return 'Space';
  if (/^[A-Za-z]$/u.test(key)) return `Key${key.toUpperCase()}`;
  if (/^[0-9]$/u.test(key)) return `Digit${key}`;
  if (/^F([1-9]|1\d|2[0-4])$/u.test(key)) return key;
  if (key.startsWith('Numpad')) return key;
  const arrows: Readonly<Record<string, string>> = {
    Down: 'ArrowDown',
    Left: 'ArrowLeft',
    Right: 'ArrowRight',
    Up: 'ArrowUp',
  };
  return arrows[key] ?? key;
};

export const captureInputFromAccelerator = (
  accelerator: string,
): HotkeyCaptureInput => {
  const parts = accelerator
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean);
  let altKey = false;
  let ctrlKey = false;
  let metaKey = false;
  let shiftKey = false;
  let key = '';
  for (const part of parts) {
    const normalized = part.toLowerCase();
    if (normalized === 'alt' || normalized === 'option') altKey = true;
    else if (normalized === 'ctrl' || normalized === 'control') ctrlKey = true;
    else if (normalized === 'shift') shiftKey = true;
    else if (
      normalized === 'win' ||
      normalized === 'command' ||
      normalized === 'meta' ||
      normalized === 'super'
    ) {
      metaKey = true;
    } else {
      key = part;
    }
  }
  return {
    altKey,
    code: acceleratorKeyCode(key),
    ctrlKey,
    key: key === 'Space' ? ' ' : key,
    metaKey,
    repeat: false,
    shiftKey,
    type: 'keyDown',
  };
};

export class RendererHotkeyCapture {
  #contents?: HotkeyCaptureTarget;
  #listener?: (event: Electron.Event, input: Electron.Input) => void;
  #onDestroyed?: () => void;

  start(contents: HotkeyCaptureTarget): void {
    this.stop();
    this.#contents = contents;
    this.#onDestroyed = () => this.stop();
    this.#listener = (event, input) => {
      if (input.type !== 'keyDown' && input.type !== 'keyUp') return;
      event.preventDefault();
      if (!this.#contents || this.#contents.isDestroyed()) return;
      const payload: HotkeyCaptureInput = {
        altKey: input.alt,
        code: input.code ?? '',
        ctrlKey: input.control,
        key: input.key ?? '',
        metaKey: input.meta,
        repeat: input.isAutoRepeat,
        shiftKey: input.shift,
        type: input.type,
      };
      this.#contents.send(IPC_CHANNELS.hotkeyCaptureEvent, payload);
    };
    contents.on('before-input-event', this.#listener);
    contents.once('destroyed', this.#onDestroyed);
  }

  emitAccelerator(accelerator: string): void {
    if (!this.#contents || this.#contents.isDestroyed()) return;
    this.#contents.send(
      IPC_CHANNELS.hotkeyCaptureEvent,
      captureInputFromAccelerator(accelerator),
    );
  }

  stop(): void {
    if (this.#contents && !this.#contents.isDestroyed()) {
      if (this.#listener) {
        this.#contents.removeListener('before-input-event', this.#listener);
      }
      if (this.#onDestroyed) {
        this.#contents.removeListener('destroyed', this.#onDestroyed);
      }
    }
    this.#contents = undefined;
    this.#listener = undefined;
    this.#onDestroyed = undefined;
  }
}
