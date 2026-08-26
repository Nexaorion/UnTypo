import { access } from 'node:fs/promises';
import { createConnection, type Socket } from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  NativeFrameDecoder,
  NativeHotkeyAction,
  NativeMessageType,
  decodeHotkeyConfigurationResult,
  decodeTargetSnapshot,
  encodeHotkeyConfiguration,
  encodeNativeFrame,
  encodePasteRequest,
  type NativeFrame,
  type NativeHotkeyConfiguration,
  type NativePasteStatus,
  type NativeTargetSnapshot,
} from './protocol.js';

interface PendingResponse {
  expectedType: NativeMessageType;
  reject: (error: Error) => void;
  resolve: (frame: NativeFrame) => void;
  timer: NodeJS.Timeout;
}

export type NativeHotkeyListener = (action: NativeHotkeyAction) => void;

export class NativeHotkeyRegistrationError extends Error {
  readonly windowsErrorCode: number;

  constructor(windowsErrorCode: number) {
    super(
      `Native hotkey registration failed with Windows error ${String(windowsErrorCode)}`,
    );
    this.name = 'NativeHotkeyRegistrationError';
    this.windowsErrorCode = windowsErrorCode;
  }
}

export const isNativeHotkeyConflictError = (error: unknown): boolean =>
  error instanceof NativeHotkeyRegistrationError &&
  error.windowsErrorCode === 1409;

const wait = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export class NativeHelperClient {
  readonly #decoder = new NativeFrameDecoder();
  readonly #executablePath: string;
  readonly #hotkeyListeners = new Set<NativeHotkeyListener>();
  #pending?: PendingResponse;
  #process?: ChildProcess;
  #requestQueue: Promise<unknown> = Promise.resolve();
  #socket?: Socket;

  constructor(executablePath: string) {
    this.#executablePath = executablePath;
  }

  async start(): Promise<void> {
    if (this.#process || this.#socket)
      throw new Error('Native helper is active');
    await access(this.#executablePath);
    const pipeName = `\\\\.\\pipe\\untypo-${String(process.pid)}-${randomUUID()}`;
    const token = randomBytes(32).toString('hex');
    const helper = spawn(
      this.#executablePath,
      ['--pipe', pipeName, '--token', token],
      { stdio: 'ignore', windowsHide: true },
    );
    this.#process = helper;
    helper.once('exit', (code) => {
      this.failPending(
        new Error(
          `Native helper exited with code ${String(code ?? 'unknown')}`,
        ),
      );
      this.#socket?.destroy();
      this.#socket = undefined;
      this.#process = undefined;
    });

    try {
      const socket = await this.connectWithRetry(pipeName);
      this.#socket = socket;
      socket.on('data', (chunk) =>
        this.handleData(
          typeof chunk === 'string' ? Buffer.from(chunk, 'binary') : chunk,
        ),
      );
      socket.once('error', (error) => this.failPending(error));
      socket.once('close', () =>
        this.failPending(new Error('Native helper pipe closed')),
      );
      await this.request(
        NativeMessageType.Authenticate,
        Buffer.from(token, 'ascii'),
        NativeMessageType.Authenticated,
      );
    } catch (error) {
      helper.kill();
      this.#process = undefined;
      this.#socket = undefined;
      throw error;
    }
  }

  async configureHotkey(
    configuration: NativeHotkeyConfiguration,
  ): Promise<void> {
    const frame = await this.request(
      NativeMessageType.ConfigureHotkey,
      encodeHotkeyConfiguration(configuration),
      NativeMessageType.HotkeyConfigured,
    );
    const errorCode = decodeHotkeyConfigurationResult(frame.payload);
    if (errorCode !== 0) throw new NativeHotkeyRegistrationError(errorCode);
  }

  async captureTarget(): Promise<NativeTargetSnapshot> {
    const frame = await this.request(
      NativeMessageType.CaptureTarget,
      undefined,
      NativeMessageType.TargetCaptured,
    );
    return decodeTargetSnapshot(frame.payload);
  }

  async paste(target: NativeTargetSnapshot): Promise<NativePasteStatus> {
    const frame = await this.request(
      NativeMessageType.Paste,
      encodePasteRequest(target),
      NativeMessageType.PasteResult,
    );
    if (frame.payload.byteLength !== 1) {
      throw new Error('Native paste response has an invalid size');
    }
    return frame.payload.readUInt8(0);
  }

  async ping(): Promise<void> {
    await this.request(
      NativeMessageType.Ping,
      undefined,
      NativeMessageType.Pong,
    );
  }

  onHotkey(listener: NativeHotkeyListener): () => void {
    this.#hotkeyListeners.add(listener);
    return () => this.#hotkeyListeners.delete(listener);
  }

  async stop(): Promise<void> {
    const socket = this.#socket;
    const helper = this.#process;
    this.#socket = undefined;
    this.#process = undefined;
    if (socket && !socket.destroyed) {
      socket.write(encodeNativeFrame(NativeMessageType.Shutdown));
      socket.end();
    }
    if (helper && helper.exitCode === null) {
      await Promise.race([
        new Promise<void>((resolve) => helper.once('exit', () => resolve())),
        wait(2_000).then(() => {
          if (helper.exitCode === null) helper.kill();
        }),
      ]);
    }
  }

  private request(
    type: NativeMessageType,
    payload: Uint8Array | undefined,
    expectedType: NativeMessageType,
  ): Promise<NativeFrame> {
    const operation = this.#requestQueue.then(
      () =>
        new Promise<NativeFrame>((resolve, reject) => {
          const timer = setTimeout(() => {
            this.#pending = undefined;
            reject(new Error('Native helper response timed out'));
          }, 5_000);
          this.#pending = { expectedType, reject, resolve, timer };
          try {
            this.write(type, payload);
          } catch (error) {
            clearTimeout(timer);
            this.#pending = undefined;
            reject(
              error instanceof Error ? error : new Error('Native write failed'),
            );
          }
        }),
    );
    this.#requestQueue = operation.catch(() => undefined);
    return operation;
  }

  private write(type: NativeMessageType, payload?: Uint8Array): void {
    if (!this.#socket || this.#socket.destroyed) {
      throw new Error('Native helper is not connected');
    }
    this.#socket.write(encodeNativeFrame(type, payload));
  }

  private handleData(chunk: Buffer): void {
    try {
      for (const frame of this.#decoder.push(chunk)) this.handleFrame(frame);
    } catch (error) {
      this.failPending(
        error instanceof Error ? error : new Error('Native protocol failed'),
      );
      this.#socket?.destroy();
    }
  }

  private handleFrame(frame: NativeFrame): void {
    if (frame.type === NativeMessageType.HotkeyEvent) {
      if (frame.payload.byteLength !== 1) return;
      const action = frame.payload.readUInt8(0);
      if (action !== Number(NativeHotkeyAction.Toggle)) return;
      for (const listener of this.#hotkeyListeners)
        listener(NativeHotkeyAction.Toggle);
      return;
    }
    const pending = this.#pending;
    if (!pending) return;
    if (frame.type !== pending.expectedType) {
      this.failPending(
        new Error('Native helper returned an unexpected response'),
      );
      return;
    }
    clearTimeout(pending.timer);
    this.#pending = undefined;
    pending.resolve(frame);
  }

  private failPending(error: Error): void {
    const pending = this.#pending;
    if (!pending) return;
    clearTimeout(pending.timer);
    this.#pending = undefined;
    pending.reject(error);
  }

  private async connectWithRetry(pipeName: string): Promise<Socket> {
    let lastError: Error = new Error('Native helper pipe is unavailable');
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        return await new Promise<Socket>((resolve, reject) => {
          const socket = createConnection(pipeName);
          socket.once('connect', () => resolve(socket));
          socket.once('error', reject);
        });
      } catch (error) {
        lastError =
          error instanceof Error ? error : new Error('Native pipe failed');
        await wait(50);
      }
    }
    throw lastError;
  }
}
