import {
  BrowserWindow,
  clipboard,
  ipcMain,
  screen,
  type IpcMainEvent,
} from 'electron';
import path from 'node:path';
import type {
  ProcessResult,
  SupportedLanguage,
} from '../../core/providers/contracts.js';
import {
  CAPSULE_CHANNELS,
  type CapsuleErrorReason,
  type CapsuleStatus,
  type DictionarySuggestionError,
} from '../../shared/capsule-ipc.js';
import { DICTIONARY_LIMITS } from '../../shared/dictionary.js';

const SUCCESS_AUTO_CLOSE_MILLISECONDS = 10_000;
const ERROR_AUTO_CLOSE_MILLISECONDS = 8_000;
const DICTIONARY_SUGGESTION_DELAY_MILLISECONDS = 1_500;

export type DictionarySuggestionDecision =
  'accepted' | 'dismissed' | 'rejected';

type DictionarySuggestionValidator = (
  term: string,
) => Promise<DictionarySuggestionError | undefined>;

const capsuleBounds = {
  compact: { height: 56, width: 276 },
  error: { height: 68, width: 420 },
  suggestion: { height: 84, width: 620 },
  success: { height: 68, width: 540 },
} as const;

const isTerminalStatus = (
  status: CapsuleStatus | undefined,
): status is Extract<
  CapsuleStatus,
  { type: 'dictionary-suggestion' | 'error' | 'success' | 'confirm' }
> =>
  status?.type === 'error' ||
  status?.type === 'success' ||
  status?.type === 'confirm' ||
  status?.type === 'dictionary-suggestion';

export class CapsuleWindowController {
  #autoCloseTimer?: NodeJS.Timeout;
  #confirmResolve?: (useProcessed: boolean) => void;
  #dictionaryAccept?: DictionarySuggestionValidator;
  #dictionaryResolve?: (decision: DictionarySuggestionDecision) => void;
  #generation = 0;
  #loading?: Promise<BrowserWindow>;
  #rendererReady = false;
  #status?: CapsuleStatus;
  #successPresentedAt = 0;
  #window?: BrowserWindow;

  constructor() {
    ipcMain.on(CAPSULE_CHANNELS.close, this.handleClose);
    ipcMain.on(CAPSULE_CHANNELS.confirm, this.handleConfirm);
    ipcMain.on(CAPSULE_CHANNELS.copy, this.handleCopy);
    ipcMain.on(CAPSULE_CHANNELS.dictionaryAccept, this.handleDictionaryAccept);
    ipcMain.on(CAPSULE_CHANNELS.dictionaryFocus, this.handleDictionaryFocus);
    ipcMain.on(CAPSULE_CHANNELS.dictionaryReject, this.handleDictionaryReject);
    ipcMain.on(CAPSULE_CHANNELS.ready, this.handleReady);
    ipcMain.on(CAPSULE_CHANNELS.reject, this.handleReject);
    ipcMain.on(CAPSULE_CHANNELS.setInteractive, this.handleSetInteractive);
  }

  async showRecording(locale: SupportedLanguage): Promise<void> {
    this.close();
    await this.present({ level: 0, locale, type: 'recording' });
  }

  async smokeTestDictionarySuggestion(): Promise<boolean> {
    const generation = await this.showSuccess(
      { intent: 'transcription', outputText: 'UnTypo smoke result' },
      'inserted',
      'en-US',
    );
    const successWebContentsId = this.#window?.webContents.id;
    let acceptedTerm = '';
    const decision = this.showDictionarySuggestion(
      'UnTypo',
      'en-US',
      generation,
      (term) => {
        acceptedTerm = term;
        return Promise.resolve(undefined);
      },
    );
    await new Promise<void>((resolve) =>
      setTimeout(resolve, DICTIONARY_SUGGESTION_DELAY_MILLISECONDS + 100),
    );
    const suggestionWindow = this.#window;
    if (
      !suggestionWindow ||
      suggestionWindow.isDestroyed() ||
      suggestionWindow.webContents.id === successWebContentsId
    ) {
      this.close();
      return false;
    }
    const rendererResult = (await suggestionWindow.webContents
      .executeJavaScript(`
      (async () => {
        const wait = (milliseconds) =>
          new Promise((resolve) => setTimeout(resolve, milliseconds));
        const capsule = document.querySelector(
          '[data-status="dictionary-suggestion"]',
        );
        const buttons = [...document.querySelectorAll('button')];
        if (!capsule || buttons.length < 3) return 'suggestion';
        buttons[1].click();
        await wait(80);
        const input = document.querySelector('input[maxlength="128"]');
        if (!(input instanceof HTMLInputElement)) return 'input';
        if (document.activeElement !== input) return 'focus';
        window.capsule.dictionaryAccept('UnTypo Smoke Edited');
        return 'ok';
      })()
    `)) as string;
    if (rendererResult !== 'ok') {
      this.close();
      return false;
    }
    const resolvedDecision = await decision;
    return (
      resolvedDecision === 'accepted' && acceptedTerm === 'UnTypo Smoke Edited'
    );
  }

  async showProcessing(locale: SupportedLanguage): Promise<void> {
    await this.present({ locale, type: 'processing' });
  }

  async showConfirm(
    result: ProcessResult,
    locale: SupportedLanguage,
  ): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.#confirmResolve = resolve;
      void this.present({
        intent: result.intent,
        locale,
        outputText: result.outputText,
        rawTranscript: result.rawTranscript ?? result.outputText,
        type: 'confirm',
      }).catch(() => {
        if (this.#confirmResolve === resolve) this.close();
      });
    });
  }

  async showSuccess(
    result: ProcessResult,
    delivery: 'copy' | 'inserted',
    locale: SupportedLanguage,
  ): Promise<number> {
    await this.present({
      delivery,
      intent: result.intent,
      locale,
      outputText: result.outputText,
      type: 'success',
    });
    this.#successPresentedAt = Date.now();
    return this.#generation;
  }

  async showDictionarySuggestion(
    term: string,
    locale: SupportedLanguage,
    expectedSuccessGeneration: number,
    validate: DictionarySuggestionValidator,
  ): Promise<DictionarySuggestionDecision> {
    const remaining = Math.max(
      0,
      DICTIONARY_SUGGESTION_DELAY_MILLISECONDS -
        (Date.now() - this.#successPresentedAt),
    );
    if (remaining > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, remaining));
    }
    if (
      this.#generation !== expectedSuccessGeneration ||
      this.#status?.type !== 'success'
    ) {
      return 'dismissed';
    }

    this.close();
    return new Promise<DictionarySuggestionDecision>((resolve) => {
      this.#dictionaryAccept = validate;
      this.#dictionaryResolve = resolve;
      void this.present({ locale, term, type: 'dictionary-suggestion' }).catch(
        () => this.close(),
      );
    });
  }

  async showError(
    reason: CapsuleErrorReason,
    locale: SupportedLanguage,
    detail?: string,
  ): Promise<void> {
    await this.present({
      ...(detail?.trim() ? { detail: detail.trim().slice(0, 240) } : {}),
      locale,
      reason,
      type: 'error',
    });
  }

  updateLevel(level: number): void {
    if (this.#status?.type !== 'recording' || !Number.isFinite(level)) return;
    const normalizedLevel = Math.max(0, Math.min(1, level));
    if (Math.abs(normalizedLevel - this.#status.level) < 0.015) return;
    this.#status = { ...this.#status, level: normalizedLevel };
    this.sendCurrentStatus();
  }

  close(): void {
    if (this.#autoCloseTimer) clearTimeout(this.#autoCloseTimer);
    this.#autoCloseTimer = undefined;
    this.#rendererReady = false;
    this.#status = undefined;
    this.#successPresentedAt = 0;
    this.#generation += 1;
    this.resolveConfirmation(false);
    this.resolveDictionarySuggestion('dismissed');
    this.#window?.destroy();
    this.#window = undefined;
  }

  destroy(): void {
    this.close();
    ipcMain.removeListener(CAPSULE_CHANNELS.close, this.handleClose);
    ipcMain.removeListener(CAPSULE_CHANNELS.confirm, this.handleConfirm);
    ipcMain.removeListener(CAPSULE_CHANNELS.copy, this.handleCopy);
    ipcMain.removeListener(
      CAPSULE_CHANNELS.dictionaryAccept,
      this.handleDictionaryAccept,
    );
    ipcMain.removeListener(
      CAPSULE_CHANNELS.dictionaryFocus,
      this.handleDictionaryFocus,
    );
    ipcMain.removeListener(
      CAPSULE_CHANNELS.dictionaryReject,
      this.handleDictionaryReject,
    );
    ipcMain.removeListener(CAPSULE_CHANNELS.ready, this.handleReady);
    ipcMain.removeListener(CAPSULE_CHANNELS.reject, this.handleReject);
    ipcMain.removeListener(
      CAPSULE_CHANNELS.setInteractive,
      this.handleSetInteractive,
    );
  }

  private readonly handleClose = (event: IpcMainEvent): void => {
    if (this.isExpectedSender(event)) this.close();
  };

  private readonly handleConfirm = (event: IpcMainEvent): void => {
    if (!this.isExpectedSender(event) || this.#status?.type !== 'confirm')
      return;
    this.resolveConfirmation(true);
    this.close();
  };

  private readonly handleReject = (event: IpcMainEvent): void => {
    if (!this.isExpectedSender(event) || this.#status?.type !== 'confirm')
      return;
    this.resolveConfirmation(false);
    this.close();
  };

  private readonly handleCopy = (event: IpcMainEvent): void => {
    if (!this.isExpectedSender(event) || this.#status?.type !== 'success')
      return;
    clipboard.writeText(this.#status.outputText);
    this.close();
  };

  private readonly handleDictionaryAccept = (
    event: IpcMainEvent,
    value: unknown,
  ): void => {
    if (
      !this.isExpectedSender(event) ||
      this.#status?.type !== 'dictionary-suggestion' ||
      this.#status.submitting ||
      typeof value !== 'string'
    ) {
      return;
    }
    if (value.length > DICTIONARY_LIMITS.termLength) {
      this.#status = {
        ...this.#status,
        error: 'too-long',
        submitting: false,
      };
      this.sendCurrentStatus();
      return;
    }
    const validate = this.#dictionaryAccept;
    if (!validate) return;
    const generation = this.#generation;
    this.#status = { ...this.#status, error: undefined, submitting: true };
    this.sendCurrentStatus();
    void validate(value)
      .then((error) => {
        if (
          this.#generation !== generation ||
          this.#status?.type !== 'dictionary-suggestion'
        ) {
          return;
        }
        if (error) {
          this.#status = { ...this.#status, error, submitting: false };
          this.sendCurrentStatus();
          return;
        }
        this.resolveDictionarySuggestion('accepted');
        this.close();
      })
      .catch(() => {
        if (
          this.#generation === generation &&
          this.#status?.type === 'dictionary-suggestion'
        ) {
          this.#status = {
            ...this.#status,
            error: 'unavailable',
            submitting: false,
          };
          this.sendCurrentStatus();
        }
      });
  };

  private readonly handleDictionaryFocus = (event: IpcMainEvent): void => {
    if (
      this.isExpectedSender(event) &&
      this.#status?.type === 'dictionary-suggestion'
    ) {
      this.#window?.focus();
    }
  };

  private readonly handleDictionaryReject = (event: IpcMainEvent): void => {
    if (
      !this.isExpectedSender(event) ||
      this.#status?.type !== 'dictionary-suggestion' ||
      this.#status.submitting
    ) {
      return;
    }
    this.resolveDictionarySuggestion('rejected');
    this.close();
  };

  private readonly handleReady = (event: IpcMainEvent): void => {
    if (!this.isExpectedSender(event)) return;
    this.#rendererReady = true;
    this.sendCurrentStatus();
  };

  private readonly handleSetInteractive = (
    event: IpcMainEvent,
    interactive: unknown,
  ): void => {
    if (
      !this.isExpectedSender(event) ||
      typeof interactive !== 'boolean' ||
      !isTerminalStatus(this.#status)
    )
      return;
    this.#window?.setIgnoreMouseEvents(!interactive, { forward: true });
  };

  private isExpectedSender(event: IpcMainEvent): boolean {
    return event.sender.id === this.#window?.webContents.id;
  }

  private resolveConfirmation(useProcessed: boolean): void {
    const resolve = this.#confirmResolve;
    this.#confirmResolve = undefined;
    resolve?.(useProcessed);
  }

  private resolveDictionarySuggestion(
    decision: DictionarySuggestionDecision,
  ): void {
    const resolve = this.#dictionaryResolve;
    this.#dictionaryAccept = undefined;
    this.#dictionaryResolve = undefined;
    resolve?.(decision);
  }

  private async present(status: CapsuleStatus): Promise<void> {
    if (this.#autoCloseTimer) clearTimeout(this.#autoCloseTimer);
    this.#autoCloseTimer = undefined;
    if (status.type !== 'dictionary-suggestion') {
      this.resolveDictionarySuggestion('dismissed');
    }
    this.#status = status;
    this.#generation += 1;

    const window = await this.ensureWindow();
    const currentStatus = this.#status;
    if (window.isDestroyed() || !currentStatus) return;

    this.sizeAndPositionWindow(window, currentStatus);
    window.setIgnoreMouseEvents(true, { forward: true });
    this.sendCurrentStatus();
    if (!window.isVisible()) window.showInactive();

    const autoCloseMilliseconds =
      currentStatus.type === 'success'
        ? SUCCESS_AUTO_CLOSE_MILLISECONDS
        : currentStatus.type === 'error'
          ? ERROR_AUTO_CLOSE_MILLISECONDS
          : undefined;
    if (autoCloseMilliseconds) {
      this.#autoCloseTimer = setTimeout(
        () => this.close(),
        autoCloseMilliseconds,
      );
    }
  }

  private sendCurrentStatus(): void {
    if (
      !this.#rendererReady ||
      !this.#status ||
      !this.#window ||
      this.#window.isDestroyed()
    )
      return;
    this.#window.webContents.send(CAPSULE_CHANNELS.update, this.#status);
  }

  private async ensureWindow(): Promise<BrowserWindow> {
    if (this.#window && !this.#window.isDestroyed()) return this.#window;
    if (this.#loading) return this.#loading;
    this.#loading = this.createAndLoadWindow();
    try {
      return await this.#loading;
    } finally {
      this.#loading = undefined;
    }
  }

  private async createAndLoadWindow(): Promise<BrowserWindow> {
    const window = this.createWindow();
    this.#window = window;
    this.#rendererReady = false;
    try {
      if (process.env.VITE_DEV_SERVER_URL) {
        await window.loadURL(`${process.env.VITE_DEV_SERVER_URL}/capsule.html`);
      } else {
        await window.loadURL('app://renderer/capsule.html');
      }
    } catch (error) {
      if (!window.isDestroyed()) window.destroy();
      if (this.#window === window) this.#window = undefined;
      throw error;
    }
    return window;
  }

  private createWindow(): BrowserWindow {
    const window = new BrowserWindow({
      alwaysOnTop: true,
      backgroundColor: '#00000000',
      frame: false,
      hasShadow: false,
      height: capsuleBounds.compact.height,
      resizable: false,
      show: false,
      skipTaskbar: true,
      transparent: true,
      width: capsuleBounds.compact.width,
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
      if (this.#window === window) {
        this.#rendererReady = false;
        this.#window = undefined;
      }
    });
    return window;
  }

  private sizeAndPositionWindow(
    window: BrowserWindow,
    status: CapsuleStatus,
  ): void {
    const bounds =
      status.type === 'dictionary-suggestion'
        ? capsuleBounds.suggestion
        : status.type === 'success' || status.type === 'confirm'
          ? capsuleBounds.success
          : status.type === 'error'
            ? capsuleBounds.error
            : capsuleBounds.compact;
    window.setSize(bounds.width, bounds.height, false);

    const display = screen.getDisplayNearestPoint(
      screen.getCursorScreenPoint(),
    );
    const { x, y, width, height } = display.workArea;
    window.setPosition(
      Math.round(x + (width - bounds.width) / 2),
      y + height - bounds.height - 24,
      false,
    );
  }
}
