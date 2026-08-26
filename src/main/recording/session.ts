import { randomUUID } from 'node:crypto';
import type { AudioPayload } from '../../core/providers/contracts.js';
import type {
  RecorderStartMetadata,
  RecorderStopMetadata,
} from '../../shared/recorder-ipc.js';
import { MINIMUM_VOICE_ACTIVITY_DURATION_MS } from '../../shared/recorder-ipc.js';
import { InMemoryAudioBuffer } from './audio-buffer.js';

export interface TargetSnapshot {
  processId: number;
  windowHandle: string;
}

export interface CompletedRecording {
  audio: AudioPayload;
  peakLevel: number;
  sessionId: string;
  target: TargetSnapshot;
  speechDurationMs: number;
  voiceDetected: boolean;
}

export type RecordingState = 'idle' | 'starting' | 'recording' | 'stopping';

export class RecordingSessionManager {
  readonly #maximumBytes: number;
  #buffer?: InMemoryAudioBuffer;
  #metadata?: RecorderStartMetadata;
  #sessionId?: string;
  #state: RecordingState = 'idle';
  #target?: TargetSnapshot;

  constructor(maximumBytes = 25 * 1024 * 1024) {
    this.#maximumBytes = maximumBytes;
  }

  get state(): RecordingState {
    return this.#state;
  }

  begin(target: TargetSnapshot): string {
    if (this.#state !== 'idle')
      throw new Error('A recording is already active');
    this.#sessionId = randomUUID();
    this.#target = { ...target };
    this.#buffer = new InMemoryAudioBuffer(this.#maximumBytes);
    this.#metadata = undefined;
    this.#state = 'starting';
    return this.#sessionId;
  }

  markStarted(sessionId: string, metadata: RecorderStartMetadata): void {
    this.assertSession(sessionId);
    if (this.#state !== 'starting') {
      throw new Error('Recorder started in an invalid state');
    }
    this.#metadata = { ...metadata };
    this.#state = 'recording';
  }

  append(sessionId: string, chunk: Uint8Array): void {
    this.assertSession(sessionId);
    if (this.#state !== 'recording' && this.#state !== 'stopping') {
      throw new Error('Recorder chunk arrived in an invalid state');
    }
    this.#buffer?.append(chunk);
  }

  requestStop(): string {
    if (
      !this.#sessionId ||
      (this.#state !== 'starting' && this.#state !== 'recording')
    ) {
      throw new Error('No recording is active');
    }
    this.#state = 'stopping';
    return this.#sessionId;
  }

  complete(
    sessionId: string,
    stopped: RecorderStopMetadata,
  ): CompletedRecording {
    this.assertSession(sessionId);
    if (this.#state !== 'stopping' || !this.#buffer || !this.#target) {
      throw new Error('Recorder stopped in an invalid state');
    }
    if (
      !Number.isFinite(stopped.durationMs) ||
      stopped.durationMs < 0 ||
      !Number.isFinite(stopped.peakLevel) ||
      stopped.peakLevel < 0 ||
      stopped.peakLevel > 1 ||
      !Number.isFinite(stopped.speechDurationMs) ||
      stopped.speechDurationMs < 0 ||
      stopped.speechDurationMs > stopped.durationMs ||
      typeof stopped.voiceDetected !== 'boolean' ||
      stopped.voiceDetected !==
        stopped.speechDurationMs >= MINIMUM_VOICE_ACTIVITY_DURATION_MS
    ) {
      throw new Error('Recorder sent invalid stop metadata');
    }
    const metadata = this.#metadata ?? stopped;
    const completed: CompletedRecording = {
      audio: {
        bytes: this.#buffer.consume(),
        channels: metadata.channels,
        durationMs: stopped.durationMs,
        mimeType: metadata.mimeType,
        sampleRateHz: metadata.sampleRateHz,
      },
      peakLevel: stopped.peakLevel,
      sessionId,
      speechDurationMs: stopped.speechDurationMs,
      target: { ...this.#target },
      voiceDetected: stopped.voiceDetected,
    };
    this.reset();
    return completed;
  }

  fail(sessionId: string): void {
    this.assertSession(sessionId);
    this.reset();
  }

  private assertSession(sessionId: string): void {
    if (!this.#sessionId || this.#sessionId !== sessionId) {
      throw new Error('Received a stale recorder session');
    }
  }

  private reset(): void {
    this.#buffer?.clear();
    this.#buffer = undefined;
    this.#metadata = undefined;
    this.#sessionId = undefined;
    this.#target = undefined;
    this.#state = 'idle';
  }
}
