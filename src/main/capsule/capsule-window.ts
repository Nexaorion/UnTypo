import {
  BrowserWindow,
  clipboard,
  ipcMain,
  screen,
  type IpcMainEvent,
} from 'electron';
import path from 'node:path';
import type { ProcessResult } from '../../core/providers/contracts.js';
import {
  CAPSULE_CHANNELS,
  type CapsuleResult,
} from '../../shared/capsule-ipc.js';

const AUTO_CLOSE_MILLISECONDS = 10_000;

export class CapsuleWindowController {
  #autoCloseTimer?: NodeJS.Timeout;
  #result?: CapsuleResult;
  #window?: BrowserWindow;

  constructor() {
    ipcMain.on(CAPSULE_CHANNELS.close, this.handleClose);
    ipcMain.on(CAPSULE_CHANNELS.copy, this.handleCopy);
    ipcMain.on(CAPSULE_CHANNELS.setInteractive, this.handleSetInteractive);
  }

  async show(result: ProcessResult): Promise<void> {
    this.close();
    this.#result = { intent: result.intent, outputText: result.outputText };
    const window = this.createWindow();
    this.#window = window;

    if (process.env.VITE_DEV_SERVER_URL) {
      await window.loadURL(`${process.env.VITE_DEV_SERVER_URL}/capsule.html`);
    } else {
      await window.loadURL('app://renderer/capsule.html');
    }
    if (window.isDestroyed()) return;
    this.positionWindow(window);
    window.webContents.send(CAPSULE_CHANNELS.result, this.#result);
    window.setIgnoreMouseEvents(true, { forward: true });
    window.showInactive();
    this.#autoCloseTimer = setTimeout(
      () => this.close(),
      AUTO_CLOSE_MILLISECONDS,
    );
  }

  close(): void {
    if (this.#autoCloseTimer) clearTimeout(this.#autoCloseTimer);
    this.#autoCloseTimer = undefined;
    this.#result = undefined;
    this.#window?.destroy();
    this.#window = undefined;
  }

  destroy(): void {
    this.close();
    ipcMain.removeListener(CAPSULE_CHANNELS.close, this.handleClose);
    ipcMain.removeListener(CAPSULE_CHANNELS.copy, this.handleCopy);
    ipcMain.removeListener(
      CAPSULE_CHANNELS.setInteractive,
      this.handleSetInteractive,
    );
  }

  private readonly handleClose = (event: IpcMainEvent): void => {
    if (this.isExpectedSender(event)) this.close();
  };

  private readonly handleCopy = (event: IpcMainEvent): void => {
    if (!this.isExpectedSender(event) || !this.#result) return;
    clipboard.writeText(this.#result.outputText);
    this.close();
  };

  private readonly handleSetInteractive = (
    event: IpcMainEvent,
    interactive: unknown,
  ): void => {
    if (!this.isExpectedSender(event) || typeof interactive !== 'boolean')
      return;
    this.#window?.setIgnoreMouseEvents(!interactive, { forward: true });
  };

  private isExpectedSender(event: IpcMainEvent): boolean {
    return event.sender.id === this.#window?.webContents.id;
  }

  private createWindow(): BrowserWindow {
    const window = new BrowserWindow({
      alwaysOnTop: true,
      backgroundColor: '#00000000',
      frame: false,
      hasShadow: false,
      height: 104,
      resizable: false,
      show: false,
      skipTaskbar: true,
      transparent: true,
      width: 520,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: path.join(__dirname, '../../preload/capsule.js'),
        sandbox: true,
      },
    });
    window.setAlwaysOnTop(true, 'floating');
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    window.once('closed', () => {
      if (this.#window === window) this.#window = undefined;
    });
    return window;
  }

  private positionWindow(window: BrowserWindow): void {
    const display = screen.getDisplayNearestPoint(
      screen.getCursorScreenPoint(),
    );
    const { x, y, width, height } = display.workArea;
    const bounds = window.getBounds();
    window.setPosition(
      Math.round(x + (width - bounds.width) / 2),
      y + height - bounds.height - 24,
      false,
    );
  }
}
