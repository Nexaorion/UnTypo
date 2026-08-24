import {
  BrowserWindow,
  ipcMain,
  type IpcMainEvent,
  type Session,
} from 'electron';
import path from 'node:path';
import {
  RECORDER_CHANNELS,
  type RecorderStartMetadata,
  type RecorderStopMetadata,
} from '../../shared/recorder-ipc.js';
import {
  RecordingSessionManager,
  type CompletedRecording,
  type TargetSnapshot,
} from './session.js';

interface PendingStop {
  sessionId: string;
  reject: (reason: Error) => void;
  resolve: (recording: CompletedRecording) => void;
}

interface PendingStart {
  reject: (reason: Error) => void;
  resolve: () => void;
  sessionId: string;
  timer: NodeJS.Timeout;
}

const isRecorderUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    if (process.env.VITE_DEV_SERVER_URL) {
      return (
        url.origin === 'http://127.0.0.1:3000' &&
        url.pathname.endsWith('/recorder.html')
      );
    }
    return (
      url.protocol === 'app:' &&
      url.host === 'renderer' &&
      url.pathname.endsWith('/recorder.html')
    );
  } catch {
    return false;
  }
};

const configurePermissions = (recorderSession: Session): void => {
  recorderSession.setPermissionCheckHandler(
    (_webContents, permission, requestingOrigin, details) =>
      permission === 'media' &&
      details.mediaType !== 'video' &&
      isRecorderUrl(details.requestingUrl ?? requestingOrigin),
  );
  recorderSession.setPermissionRequestHandler(
    (webContents, permission, callback, details) => {
      const mediaTypes =
        'mediaTypes' in details ? details.mediaTypes : undefined;
      const audioOnly =
        mediaTypes === undefined ||
        (mediaTypes.includes('audio') && !mediaTypes.includes('video'));
      callback(
        permission === 'media' &&
          audioOnly &&
          isRecorderUrl(webContents.getURL()),
      );
    },
  );
};

export class RecorderWindowController {
  readonly #sessions: RecordingSessionManager;
  #initializing?: Promise<void>;
  #pendingStart?: PendingStart;
  #pendingStop?: PendingStop;
  #window?: BrowserWindow;

  constructor(maximumBytes?: number) {
    this.#sessions = new RecordingSessionManager(maximumBytes);
    ipcMain.on(RECORDER_CHANNELS.started, this.handleStarted);
    ipcMain.on(RECORDER_CHANNELS.chunk, this.handleChunk);
    ipcMain.on(RECORDER_CHANNELS.stopped, this.handleStopped);
    ipcMain.on(RECORDER_CHANNELS.error, this.handleError);
  }

  async initialize(): Promise<void> {
    if (this.#initializing) return this.#initializing;
    this.#initializing = this.createWindow();
    return this.#initializing;
  }

  async start(target: TargetSnapshot): Promise<string> {
    await this.initialize();
    const sessionId = this.#sessions.begin(target);
    const started = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.rejectSession(
          sessionId,
          new Error('Recorder start confirmation timed out'),
        );
      }, 10_000);
      this.#pendingStart = { reject, resolve, sessionId, timer };
    });
    this.#window?.webContents.send(RECORDER_CHANNELS.commandStart, sessionId);
    await started;
    return sessionId;
  }

  stop(): Promise<CompletedRecording> {
    if (this.#pendingStop) {
      return Promise.reject(new Error('Recorder stop is already pending'));
    }
    const sessionId = this.#sessions.requestStop();
    const result = new Promise<CompletedRecording>((resolve, reject) => {
      this.#pendingStop = { reject, resolve, sessionId };
    });
    this.#window?.webContents.send(RECORDER_CHANNELS.commandStop, sessionId);
    return result;
  }

  async smokeTest(): Promise<boolean> {
    await this.initialize();
    return (await this.#window?.webContents.executeJavaScript(
      'typeof window.recorder?.onStart === "function"',
    )) as boolean;
  }

  destroy(): void {
    ipcMain.removeListener(RECORDER_CHANNELS.started, this.handleStarted);
    ipcMain.removeListener(RECORDER_CHANNELS.chunk, this.handleChunk);
    ipcMain.removeListener(RECORDER_CHANNELS.stopped, this.handleStopped);
    ipcMain.removeListener(RECORDER_CHANNELS.error, this.handleError);
    if (this.#pendingStart) {
      clearTimeout(this.#pendingStart.timer);
      this.#pendingStart.reject(new Error('Recorder was destroyed'));
      this.#pendingStart = undefined;
    }
    this.#pendingStop?.reject(new Error('Recorder was destroyed'));
    this.#pendingStop = undefined;
    this.#window?.destroy();
    this.#window = undefined;
  }

  private readonly handleStarted = (
    event: IpcMainEvent,
    sessionId: string,
    metadata: RecorderStartMetadata,
  ): void => {
    if (!this.isExpectedSender(event)) return;
    try {
      this.#sessions.markStarted(sessionId, metadata);
      if (this.#pendingStart?.sessionId === sessionId) {
        clearTimeout(this.#pendingStart.timer);
        this.#pendingStart.resolve();
        this.#pendingStart = undefined;
      }
    } catch (error) {
      this.rejectSession(
        sessionId,
        error instanceof Error ? error : new Error('Recorder start failed'),
      );
    }
  };

  private readonly handleChunk = (
    event: IpcMainEvent,
    sessionId: string,
    chunk: ArrayBuffer,
  ): void => {
    if (!this.isExpectedSender(event)) return;
    if (!(chunk instanceof ArrayBuffer)) {
      this.rejectSession(
        sessionId,
        new Error('Recorder sent an invalid chunk'),
      );
      return;
    }
    try {
      this.#sessions.append(sessionId, new Uint8Array(chunk));
    } catch (error) {
      this.rejectSession(
        sessionId,
        error instanceof Error ? error : new Error('Recorder buffer failed'),
      );
    }
  };

  private readonly handleStopped = (
    event: IpcMainEvent,
    sessionId: string,
    metadata: RecorderStopMetadata,
  ): void => {
    if (!this.isExpectedSender(event)) return;
    try {
      const completed = this.#sessions.complete(sessionId, metadata);
      if (this.#pendingStop?.sessionId === sessionId) {
        this.#pendingStop.resolve(completed);
        this.#pendingStop = undefined;
      }
    } catch (error) {
      this.rejectSession(
        sessionId,
        error instanceof Error ? error : new Error('Recorder stop failed'),
      );
    }
  };

  private readonly handleError = (
    event: IpcMainEvent,
    sessionId: string,
    message: string,
  ): void => {
    if (!this.isExpectedSender(event)) return;
    this.rejectSession(sessionId, new Error(message));
  };

  private isExpectedSender(event: IpcMainEvent): boolean {
    return event.sender.id === this.#window?.webContents.id;
  }

  private rejectSession(sessionId: string, error: Error): void {
    try {
      this.#sessions.fail(sessionId);
    } catch {
      return;
    }
    if (this.#pendingStart?.sessionId === sessionId) {
      clearTimeout(this.#pendingStart.timer);
      this.#pendingStart.reject(error);
      this.#pendingStart = undefined;
    }
    if (this.#pendingStop?.sessionId === sessionId) {
      this.#pendingStop.reject(error);
      this.#pendingStop = undefined;
    }
  }

  private async createWindow(): Promise<void> {
    const window = new BrowserWindow({
      height: 1,
      show: false,
      skipTaskbar: true,
      width: 1,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: path.join(__dirname, '../../preload/recorder.js'),
        sandbox: true,
      },
    });
    this.#window = window;
    configurePermissions(window.webContents.session);
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());

    if (process.env.VITE_DEV_SERVER_URL) {
      await window.loadURL(`${process.env.VITE_DEV_SERVER_URL}/recorder.html`);
    } else {
      await window.loadURL('app://renderer/recorder.html');
    }
  }
}
