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
  readonly #restoreDelayMs: number;
  #restoreGeneration = 0;

  constructor(
    clipboard: ClipboardPort<Snapshot>,
    native: NativePastePort,
    delay: (milliseconds: number) => Promise<void> = defaultDelay,
    restoreDelayMs = 120,
  ) {
    this.#clipboard = clipboard;
    this.#native = native;
    this.#delay = delay;
    this.#restoreDelayMs = restoreDelayMs;
  }

  async inject(
    text: string,
    target: NativeTargetSnapshot,
  ): Promise<InjectionResult> {
    this.#restoreGeneration += 1;
    const snapshot = await this.#clipboard.readSnapshot();
    await this.#clipboard.writeText(text);
    const status = await this.#native.paste(target);
    if (status !== NativePasteStatus.Success) {
      return { injected: false, status };
    }

    this.scheduleRestore(text, snapshot);
    return { injected: true, status };
  }

  private scheduleRestore(text: string, snapshot: Snapshot): void {
    const generation = this.#restoreGeneration;
    void this.#delay(this.#restoreDelayMs)
      .then(async () => {
        if (generation !== this.#restoreGeneration) return;
        if (await this.#clipboard.isCurrentText(text)) {
          await this.#clipboard.restore(snapshot);
        }
      })
      .catch(() => undefined);
  }
}
