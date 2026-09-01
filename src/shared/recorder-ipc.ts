import type { ProviderAudioFormat } from '../core/providers/contracts.js';
import type {
  MicrophoneDeviceInfo,
  MicrophoneSelection,
} from './microphone.js';

export const RECORDER_CHANNELS = {
  chunk: 'recorder:chunk',
  commandStart: 'recorder:command-start',
  commandStop: 'recorder:command-stop',
  commandListDevices: 'recorder:command-list-devices',
  devices: 'recorder:devices',
  error: 'recorder:error',
  level: 'recorder:level',
  realtimeChunk: 'recorder:realtime-chunk',
  started: 'recorder:started',
  stopped: 'recorder:stopped',
} as const;

export const MINIMUM_VOICE_ACTIVITY_DURATION_MS = 160;

export interface RecorderStartMetadata {
  channels: number;
  mimeType: string;
  sampleRateHz: number;
}

export interface RecorderStopMetadata extends RecorderStartMetadata {
  durationMs: number;
  peakLevel: number;
  speechDurationMs: number;
  voiceDetected: boolean;
}

export type RecorderDeviceInfo = MicrophoneDeviceInfo;

export interface RecorderApi {
  onListDevices: (listener: (requestId: string) => void) => void;
  onStart: (
    listener: (
      sessionId: string,
      microphoneSelection?: MicrophoneSelection,
      outputFormat?: ProviderAudioFormat,
      realtimePcmEnabled?: boolean,
    ) => void,
  ) => void;
  onStop: (listener: (sessionId: string) => void) => void;
  sendChunk: (sessionId: string, chunk: ArrayBuffer) => void;
  sendError: (sessionId: string, message: string) => void;
  sendDevices: (
    requestId: string,
    devices: readonly RecorderDeviceInfo[],
    error?: string,
  ) => void;
  sendLevel: (sessionId: string, level: number) => void;
  sendRealtimeChunk: (sessionId: string, chunk: ArrayBuffer) => void;
  sendStarted: (
    sessionId: string,
    metadata: RecorderStartMetadata,
    microphoneSelection?: MicrophoneSelection,
  ) => void;
  sendStopped: (sessionId: string, metadata: RecorderStopMetadata) => void;
}
