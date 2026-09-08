import {
  BrowserWindow,
  clipboard,
  ipcMain,
  screen,
  type IpcMainInvokeEvent,
} from 'electron';
import path from 'node:path';
import type { ProcessResult } from '../../core/providers/contracts.js';
import { SELECTION_CHANNELS } from '../../shared/selection-ipc.js';
import { ElectronClipboardAdapter } from '../dictation/electron-clipboard.js';
import type { NativeHelperClient } from '../native/client.js';
import {
  NativePasteStatus,
  type NativeTargetSnapshot,
} from '../native/protocol.js';
import { assertTrustedSender } from '../security.js';
import { selectionBounds } from './placement.js';
import {
  parseSelectionAction,
  SelectionSession,
  type SelectionContext,
} from './session.js';

export interface SelectionWindowOptions {
  native: Pick<
    NativeHelperClient,
    'captureSelection' | 'replaceSelection' | 'clearSelection' | 'captureTarget'
  >;
  context: () => Promise<SelectionContext>;
}

export class SelectionWindowController {
  readonly #options: SelectionWindowOptions;
  #window?: BrowserWindow;
  #session?: SelectionSession;
  #opening = false;
  #mutating = false;
  #destroyed = false;
  #requestGeneration = 0;
  #cursor = { x: 0, y: 0 };

  constructor(options: SelectionWindowOptions) {
    this.#options = options;
    ipcMain.handle(SELECTION_CHANNELS.state, (event) => {
      this.assertSender(event);
      return this.#session?.state;
    });
    for (const action of [
      'retry',
      'cancel',
      'copy',
      'replace',
      'close',
    ] as const) {
      ipcMain.handle(
        SELECTION_CHANNELS[action],
        async (event, value: unknown) => {
          this.assertSender(event);
          const input = parseSelectionAction(value);
          const session = this.#session;
          if (!session || session.state.sessionId !== input.sessionId)
            throw new Error('Selection session expired');
          if (this.#mutating) return;
          if (action === 'close') {
            this.close();
            return;
          }
          if (action === 'cancel') {
            this.#requestGeneration += 1;
            session.cancel();
            return;
          }
          if (action === 'retry') {
            if (!session.state.instruction || session.state.characters === 0)
              return;
            const generation = ++this.#requestGeneration;
            try {
              const context = await this.#options.context();
              if (
                this.#session === session &&
                this.#requestGeneration === generation
              )
                await session.run(session.state.instruction, context);
            } catch {
              if (this.#session === session) session.fail('processing');
            }
            return;
          }
          if (!session.state.output || session.state.phase === 'processing')
            return;
          this.#mutating = true;
          try {
            if (action === 'copy')
              await clipboard.writeText(session.state.output);
            else if (session.state.editable) await this.replace(session);
          } catch {
            if (this.#session === session) session.fail(action);
            throw new Error('Selection action failed');
          } finally {
            this.#mutating = false;
          }
        },
      );
    }
  }

  get isOpen(): boolean {
    return this.#opening || this.#session !== undefined;
  }

  get isBusy(): boolean {
    return this.#opening || this.#mutating;
  }

  async prepareVoice(target: NativeTargetSnapshot): Promise<boolean> {
    if (this.#destroyed || this.isBusy) return false;
    if (
      this.#window &&
      this.#session &&
      this.#session.state.characters > 0 &&
      this.#window.getNativeWindowHandle().readBigUInt64LE().toString() ===
        target.windowHandle
    ) {
      this.#requestGeneration += 1;
      this.#window.hide();
      this.#session.cancel();
      return true;
    }
    this.close();
    this.#cursor = screen.getCursorScreenPoint();
    const selection = await this.#options.native.captureSelection();
    if (!selection.text.trim()) return false;
    const current = await this.#options.native.captureTarget();
    if (
      current.windowHandle !== target.windowHandle ||
      current.processId !== target.processId
    ) {
      await this.#options.native.clearSelection();
      return false;
    }
    const context = await this.#options.context();
    if (this.#destroyed) return false;
    const session = this.createSession(context);
    session.capture(selection);
    return session.state.characters > 0;
  }

  async processVoice(instruction: string): Promise<void> {
    const session = this.#session;
    if (!session) return;
    const context = await this.#options.context();
    if (this.#session !== session) return;
    const processing = session.run(instruction, context);
    await this.open();
    await processing;
  }

  async showResult(result: ProcessResult): Promise<void> {
    this.close();
    const context = await this.#options.context();
    if (this.#destroyed) return;
    this.createSession(context).showResult(result);
    await this.open();
  }

  private createSession(context: SelectionContext): SelectionSession {
    const session = new SelectionSession(context.locale, (state) => {
      if (
        this.#session === session &&
        this.#window &&
        !this.#window.isDestroyed()
      )
        this.#window.webContents.send(SELECTION_CHANNELS.changed, state);
    });
    this.#session = session;
    return session;
  }

  private async open(): Promise<void> {
    if (this.#destroyed || this.#opening || this.#mutating) return;
    if (this.#window) {
      this.#window.show();
      this.#window.focus();
      return;
    }
    this.#opening = true;
    const cursor = this.#cursor;
    try {
      if (this.#destroyed || !this.#session) return;
      const window = new BrowserWindow({
        ...selectionBounds(
          cursor,
          screen.getDisplayNearestPoint(cursor).workArea,
        ),
        alwaysOnTop: true,
        frame: false,
        transparent: true,
        hasShadow: false,
        resizable: false,
        maximizable: false,
        minimizable: false,
        skipTaskbar: true,
        show: false,
        title: 'UnTypo',
        backgroundColor: '#00000000',
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          preload: path.join(__dirname, '../../preload/selection.js'),
        },
      });
      this.#window = window;
      window.removeMenu();
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', (event) => event.preventDefault());
      window.webContents.on('before-input-event', (event, input) => {
        if (
          input.type === 'keyDown' &&
          input.key === 'Escape' &&
          !this.#mutating
        ) {
          event.preventDefault();
          this.close();
        }
      });
      window.once('closed', () => {
        if (this.#window === window) this.close();
      });
      window.webContents.once('render-process-gone', () => this.close());
      await window.loadURL(
        process.env.VITE_DEV_SERVER_URL
          ? new URL('selection.html', process.env.VITE_DEV_SERVER_URL).href
          : 'app://renderer/selection.html',
      );
      if (this.#window === window && !window.isDestroyed()) {
        window.show();
        window.focus();
      }
    } catch {
      this.close();
      throw new Error('Unable to open voice result window');
    } finally {
      this.#opening = false;
    }
  }

  close(): void {
    this.#requestGeneration += 1;
    this.#session?.dispose();
    this.#session = undefined;
    const window = this.#window;
    this.#window = undefined;
    if (window && !window.isDestroyed()) window.destroy();
    void this.#options.native.clearSelection().catch(() => undefined);
  }

  destroy(): void {
    this.#destroyed = true;
    this.close();
    for (const channel of Object.values(SELECTION_CHANNELS)) {
      if (channel !== SELECTION_CHANNELS.changed)
        ipcMain.removeHandler(channel);
    }
  }

  private assertSender(event: IpcMainInvokeEvent): void {
    assertTrustedSender(event);
    if (
      !this.#window ||
      event.sender.id !== this.#window.webContents.id ||
      event.senderFrame !== event.sender.mainFrame
    )
      throw new Error('Untrusted selection sender');
  }

  private async replace(session: SelectionSession): Promise<void> {
    const adapter = new ElectronClipboardAdapter();
    const original = await adapter.readSnapshot();
    const output = session.state.output;
    let succeeded = false;
    try {
      await adapter.writeText(output);
      this.#window?.hide();
      const status = await this.#options.native.replaceSelection();
      succeeded = status === NativePasteStatus.Success;
      if (succeeded)
        await new Promise<void>((resolve) => setTimeout(resolve, 150));
    } finally {
      try {
        if (await adapter.isCurrentText(output))
          await adapter.restore(original);
      } finally {
        if (this.#session === session) {
          if (succeeded) this.close();
          else {
            session.fail('replace');
            this.#window?.show();
            this.#window?.focus();
          }
        }
      }
    }
  }
}
