import { globalShortcut, type WebContents } from 'electron';
import type { DiagnosticCollector } from '../diagnostics/collector.js';
import {
  NATIVE_HOTKEY_ALREADY_REGISTERED,
  type NativeHelperClient,
  NativeHotkeyRegistrationError,
} from '../native/client.js';
import { RendererHotkeyCapture } from '../native/hotkey-capture.js';
import {
  parseHotkeyAccelerator,
  toElectronAccelerator,
} from '../native/hotkey.js';
import { NativeHotkeyAction } from '../native/protocol.js';
import type { ConfigurationService } from '../storage/configuration.js';

export interface HotkeyManagerOptions {
  configuration: ConfigurationService;
  diagnostics: DiagnosticCollector;
  native: NativeHelperClient;
  onAction: (action: NativeHotkeyAction) => void;
}

export class HotkeyManager {
  readonly #capture = new RendererHotkeyCapture();
  #captureActive = false;
  #pendingAccelerator?: string;
  #darwinAccelerator?: string;
  #removeNativeListener?: () => void;
  readonly #configuration: ConfigurationService;
  readonly #diagnostics: DiagnosticCollector;
  readonly #native: NativeHelperClient;
  readonly #onAction: (action: NativeHotkeyAction) => void;

  constructor(options: HotkeyManagerOptions) {
    this.#configuration = options.configuration;
    this.#diagnostics = options.diagnostics;
    this.#native = options.native;
    this.#onAction = options.onAction;
  }

  isCaptureActive(): boolean {
    return this.#captureActive;
  }

  start(): void {
    this.#removeNativeListener = this.#native.onHotkey((action) => {
      if (this.#captureActive) return;
      this.#diagnostics.log({
        context: { action: 'toggle' },
        message: 'Native hotkey event received',
        scope: 'hotkey.event',
      });
      if (process.env.UNTYPO_HOTKEY_PROBE === '1') return;
      this.#onAction(action);
    });
  }

  async apply(accelerator: string): Promise<void> {
    const nativeHotkey = parseHotkeyAccelerator(accelerator);
    this.#pendingAccelerator = accelerator;
    if (this.#captureActive) {
      this.#logHotkeyConfiguration(accelerator, nativeHotkey);
      return;
    }
    if (process.platform === 'darwin') {
      this.#registerDarwinHotkey(accelerator);
      this.#logHotkeyConfiguration(accelerator, nativeHotkey);
      this.#pendingAccelerator = undefined;
      return;
    }
    await this.#native.configureHotkey(nativeHotkey);
    this.#logHotkeyConfiguration(accelerator, nativeHotkey);
    this.#pendingAccelerator = undefined;
  }

  async setCaptureActive(active: boolean, sender?: WebContents): Promise<void> {
    if (this.#captureActive === active) {
      if (active && sender) this.#capture.start(sender);
      return;
    }
    if (active) {
      this.#captureActive = true;
      this.#unregisterDarwinHotkey();
      if (sender) this.#capture.start(sender);
      return;
    }
    const previous = (await this.#configuration.load()).dictation
      .hotkeyAccelerator;
    const accelerator = this.#pendingAccelerator ?? previous;
    this.#capture.stop();
    this.#captureActive = false;
    try {
      await this.apply(accelerator);
    } catch (error) {
      this.#diagnostics.recordIssue({
        context: { accelerator },
        error,
        kind: 'configuration',
        source: 'hotkey.capture-resume',
      });
      try {
        await this.apply(previous);
      } catch (rollbackError) {
        this.#diagnostics.recordIssue({
          error: rollbackError,
          kind: 'internal',
          source: 'hotkey.capture-resume-rollback',
        });
      }
      throw error;
    }
  }

  stop(): void {
    this.#removeNativeListener?.();
    this.#removeNativeListener = undefined;
    this.#capture.stop();
    this.#captureActive = false;
    this.#unregisterDarwinHotkey();
  }

  #registerDarwinHotkey(accelerator: string): void {
    const electronAccelerator = toElectronAccelerator(accelerator);
    if (electronAccelerator === this.#darwinAccelerator) return;
    if (
      !globalShortcut.register(electronAccelerator, () => {
        this.#diagnostics.log({
          context: { action: 'toggle', accelerator },
          message: 'Native hotkey event received',
          scope: 'hotkey.event',
        });
        if (this.#captureActive) {
          this.#capture.emitAccelerator(accelerator);
          return;
        }
        if (process.env.UNTYPO_HOTKEY_PROBE === '1') return;
        this.#onAction(NativeHotkeyAction.Toggle);
      })
    ) {
      throw new NativeHotkeyRegistrationError(NATIVE_HOTKEY_ALREADY_REGISTERED);
    }
    const previous = this.#darwinAccelerator;
    this.#darwinAccelerator = electronAccelerator;
    if (previous) globalShortcut.unregister(previous);
  }

  #unregisterDarwinHotkey(): void {
    if (!this.#darwinAccelerator) return;
    globalShortcut.unregister(this.#darwinAccelerator);
    this.#darwinAccelerator = undefined;
  }

  #logHotkeyConfiguration(
    accelerator: string,
    configuration: ReturnType<typeof parseHotkeyAccelerator>,
  ): void {
    this.#diagnostics.log({
      context: {
        accelerator,
        modifiers: configuration.modifiers,
        virtualKey: configuration.virtualKey,
      },
      message: 'Native hotkey configured',
      scope: 'hotkey.configuration',
    });
  }
}
