import type { NativeTargetSnapshot } from '../native/protocol.js';
import { NativePasteStatus } from '../native/protocol.js';

export interface ClipboardPort<Snapshot = unknown> {
  isCurrentText: (text: string) => boolean | Promise<boolean>;
  readSnapshot: () => Snapshot | Promise<Snapshot>;
  restore: (snapshot: Snapshot) => void | Promise<void>;
  writeText: (text: string) => void | Promise<void>;
}

export interface NativePastePort {
  paste: (target: NativeTargetSnapshot) => Promise<NativePasteStatus>;
}

export interface InjectionResult {
  injected: boolean;
  status: NativePasteStatus;
}

const defaultDelay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export class ClipboardInjectionService<Snapshot = unknown> {
  readonly #clipboard: ClipboardPort<Snapshot>;
  readonly #delay: (milliseconds: number) => Promise<void>;
  readonly #native: NativePastePort;

  constructor(
    clipboard: ClipboardPort<Snapshot>,
    native: NativePastePort,
    delay: (milliseconds: number) => Promise<void> = defaultDelay,
  ) {
    this.#clipboard = clipboard;
    this.#native = native;
    this.#delay = delay;
  }

  async inject(
    text: string,
    target: NativeTargetSnapshot,
  ): Promise<InjectionResult> {
    const snapshot = await this.#clipboard.readSnapshot();
    await this.#clipboard.writeText(text);
    const status = await this.#native.paste(target);
    if (status !== NativePasteStatus.Success) {
      return { injected: false, status };
    }

    await this.#delay(120);
    if (await this.#clipboard.isCurrentText(text)) {
      await this.#clipboard.restore(snapshot);
    }
    return { injected: true, status };
  }
}
