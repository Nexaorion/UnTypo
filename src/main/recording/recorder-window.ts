import {
  BrowserWindow,
  ipcMain,
  type IpcMainEvent,
  type Session,
} from 'electron';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { ProviderAudioFormat } from '../../core/providers/contracts.js';
import type { MicrophoneSelection } from '../../shared/microphone.js';
import {
  RECORDER_CHANNELS,
  type RecorderDeviceInfo,
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
  resolve: (selection?: MicrophoneSelection) => void;
  sessionId: string;
  timer: NodeJS.Timeout;
}

interface PendingDeviceRequest {
  reject: (reason: Error) => void;
  resolve: (devices: readonly RecorderDeviceInfo[]) => void;
  timer: NodeJS.Timeout;
}

interface RealtimeAudioSink {
  listener: (chunk: Uint8Array) => void;
  sessionId: string;
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

const parseMicrophoneSelection = (
  value: unknown,
): MicrophoneSelection | undefined => {
  if (value === undefined) return undefined;
  if (
    typeof value !== 'object' ||
    value === null ||
    !('deviceId' in value) ||
    typeof value.deviceId !== 'string' ||
    value.deviceId.length === 0 ||
    value.deviceId.length > 512 ||
    ('label' in value &&
      value.label !== undefined &&
      (typeof value.label !== 'string' ||
        value.label.trim().length === 0 ||
        value.label.length > 512))
  ) {
    throw new Error('Recorder returned an invalid microphone selection');
  }
  return {
    deviceId: value.deviceId,
    ...('label' in value && typeof value.label === 'string'
      ? { label: value.label }
      : {}),
  };
};

export class RecorderWindowController {
  readonly #onLevel?: (level: number) => void;
  readonly #onMicrophoneResolved?: (
    requested: MicrophoneSelection,
    resolved: MicrophoneSelection,
  ) => void;
  readonly #sessions: RecordingSessionManager;
  readonly #pendingDeviceRequests = new Map<string, PendingDeviceRequest>();
  #activeSessionId?: string;
  #initializing?: Promise<void>;
  #pendingStart?: PendingStart;
  #pendingStop?: PendingStop;
  #realtimeAudioSink?: RealtimeAudioSink;
  #window?: BrowserWindow;

  constructor(
    maximumBytes?: number,
    onLevel?: (level: number) => void,
    onMicrophoneResolved?: (
      requested: MicrophoneSelection,
      resolved: MicrophoneSelection,
    ) => void,
  ) {
    this.#onLevel = onLevel;
    this.#onMicrophoneResolved = onMicrophoneResolved;
    this.#sessions = new RecordingSessionManager(maximumBytes);
    ipcMain.on(RECORDER_CHANNELS.started, this.handleStarted);
    ipcMain.on(RECORDER_CHANNELS.chunk, this.handleChunk);
    ipcMain.on(RECORDER_CHANNELS.level, this.handleLevel);
    ipcMain.on(RECORDER_CHANNELS.realtimeChunk, this.handleRealtimeChunk);
    ipcMain.on(RECORDER_CHANNELS.stopped, this.handleStopped);
    ipcMain.on(RECORDER_CHANNELS.error, this.handleError);
    ipcMain.on(RECORDER_CHANNELS.devices, this.handleDevices);
  }

  async initialize(): Promise<void> {
    if (this.#initializing) return this.#initializing;
    this.#initializing = this.createWindow();
    return this.#initializing;
  }

  async start(
    target: TargetSnapshot,
    microphoneSelection?: MicrophoneSelection,
    outputFormat: ProviderAudioFormat = 'webm',
    onRealtimeAudioChunk?: (chunk: Uint8Array) => void,
  ): Promise<string> {
    await this.initialize();
    const sessionId = this.#sessions.begin(target);
    this.#activeSessionId = sessionId;
    this.#realtimeAudioSink = onRealtimeAudioChunk
      ? { listener: onRealtimeAudioChunk, sessionId }
      : undefined;
    const started = new Promise<MicrophoneSelection | undefined>(
      (resolve, reject) => {
        const timer = setTimeout(() => {
          this.rejectSession(
            sessionId,
            new Error('Recorder start confirmation timed out'),
          );
        }, 10_000);
        this.#pendingStart = { reject, resolve, sessionId, timer };
      },
    );
    this.#window?.webContents.send(
      RECORDER_CHANNELS.commandStart,
      sessionId,
      microphoneSelection,
      outputFormat,
      onRealtimeAudioChunk !== undefined,
    );
    const resolvedMicrophone = await started;
    if (microphoneSelection && resolvedMicrophone) {
      this.#onMicrophoneResolved?.(microphoneSelection, resolvedMicrophone);
    }
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

  async listDevices(): Promise<readonly RecorderDeviceInfo[]> {
    await this.initialize();
    const requestId = randomUUID();
    const result = new Promise<readonly RecorderDeviceInfo[]>(
      (resolve, reject) => {
        const timer = setTimeout(() => {
          this.#pendingDeviceRequests.delete(requestId);
          reject(new Error('Microphone device discovery timed out'));
        }, 5_000);
        this.#pendingDeviceRequests.set(requestId, { reject, resolve, timer });
      },
    );
    this.#window?.webContents.send(
      RECORDER_CHANNELS.commandListDevices,
      requestId,
    );
    return result;
  }

  async smokeTest(): Promise<boolean> {
    await this.initialize();
    const bridgeReady = (await this.#window?.webContents.executeJavaScript(
      'typeof window.recorder?.onStart === "function" && typeof window.recorder?.onListDevices === "function"',
    )) as boolean;
    if (!bridgeReady) return false;
    await this.listDevices();
    return true;
  }

  destroy(): void {
    ipcMain.removeListener(RECORDER_CHANNELS.started, this.handleStarted);
    ipcMain.removeListener(RECORDER_CHANNELS.chunk, this.handleChunk);
    ipcMain.removeListener(RECORDER_CHANNELS.level, this.handleLevel);
    ipcMain.removeListener(
      RECORDER_CHANNELS.realtimeChunk,
      this.handleRealtimeChunk,
    );
    ipcMain.removeListener(RECORDER_CHANNELS.stopped, this.handleStopped);
    ipcMain.removeListener(RECORDER_CHANNELS.error, this.handleError);
    ipcMain.removeListener(RECORDER_CHANNELS.devices, this.handleDevices);
    for (const pending of this.#pendingDeviceRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Recorder was destroyed'));
    }
    this.#pendingDeviceRequests.clear();
    if (this.#pendingStart) {
      clearTimeout(this.#pendingStart.timer);
      this.#pendingStart.reject(new Error('Recorder was destroyed'));
      this.#pendingStart = undefined;
    }
    this.#pendingStop?.reject(new Error('Recorder was destroyed'));
    this.#pendingStop = undefined;
    this.#activeSessionId = undefined;
    this.#realtimeAudioSink = undefined;
    this.#window?.destroy();
    this.#window = undefined;
  }

  private readonly handleStarted = (
    event: IpcMainEvent,
    sessionId: string,
    metadata: RecorderStartMetadata,
    microphoneSelection: unknown,
  ): void => {
    if (!this.isExpectedSender(event)) return;
    try {
      const resolvedMicrophone = parseMicrophoneSelection(microphoneSelection);
      this.#sessions.markStarted(sessionId, metadata);
      if (this.#pendingStart?.sessionId === sessionId) {
        clearTimeout(this.#pendingStart.timer);
        this.#pendingStart.resolve(resolvedMicrophone);
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

  private readonly handleLevel = (
    event: IpcMainEvent,
    sessionId: unknown,
    level: unknown,
  ): void => {
    if (
      !this.isExpectedSender(event) ||
      typeof sessionId !== 'string' ||
      sessionId !== this.#activeSessionId ||
      typeof level !== 'number' ||
      !Number.isFinite(level)
    ) {
      return;
    }
    this.#onLevel?.(Math.min(1, Math.max(0, level)));
  };

  private readonly handleRealtimeChunk = (
    event: IpcMainEvent,
    sessionId: unknown,
    chunk: unknown,
  ): void => {
    const sink = this.#realtimeAudioSink;
    if (
      !this.isExpectedSender(event) ||
      typeof sessionId !== 'string' ||
      sink?.sessionId !== sessionId ||
      !(chunk instanceof ArrayBuffer) ||
      chunk.byteLength === 0 ||
      chunk.byteLength > 256 * 1024
    ) {
      return;
    }
    try {
      sink.listener(new Uint8Array(chunk));
    } catch {
      this.#realtimeAudioSink = undefined;
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
      if (this.#activeSessionId === sessionId) {
        this.#activeSessionId = undefined;
      }
      if (this.#realtimeAudioSink?.sessionId === sessionId) {
        this.#realtimeAudioSink = undefined;
      }
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

  private readonly handleDevices = (
    event: IpcMainEvent,
    requestId: unknown,
    devices: unknown,
    error: unknown,
  ): void => {
    if (!this.isExpectedSender(event) || typeof requestId !== 'string') return;
    const pending = this.#pendingDeviceRequests.get(requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.#pendingDeviceRequests.delete(requestId);
    if (typeof error === 'string' && error.trim()) {
      pending.reject(new Error(error.slice(0, 500)));
      return;
    }
    if (!Array.isArray(devices) || devices.length > 128) {
      pending.reject(new Error('Recorder returned an invalid device list'));
      return;
    }
    const normalized = new Map<string, RecorderDeviceInfo>();
    for (const candidate of devices as unknown[]) {
      if (
        typeof candidate !== 'object' ||
        candidate === null ||
        !('deviceId' in candidate) ||
        typeof candidate.deviceId !== 'string' ||
        candidate.deviceId.length === 0 ||
        candidate.deviceId.length > 512 ||
        !('label' in candidate) ||
        typeof candidate.label !== 'string' ||
        candidate.label.length === 0 ||
        candidate.label.length > 512 ||
        ('generatedLabel' in candidate &&
          candidate.generatedLabel !== undefined &&
          typeof candidate.generatedLabel !== 'boolean')
      ) {
        pending.reject(new Error('Recorder returned an invalid device list'));
        return;
      }
      if (!normalized.has(candidate.deviceId)) {
        normalized.set(candidate.deviceId, {
          deviceId: candidate.deviceId,
          ...('generatedLabel' in candidate && candidate.generatedLabel === true
            ? { generatedLabel: true }
            : {}),
          label: candidate.label,
        });
      }
    }
    pending.resolve([...normalized.values()]);
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
    if (this.#activeSessionId === sessionId) {
      this.#activeSessionId = undefined;
    }
    if (this.#realtimeAudioSink?.sessionId === sessionId) {
      this.#realtimeAudioSink = undefined;
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
        backgroundThrottling: false,
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
