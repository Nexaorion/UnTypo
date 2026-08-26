export const RECORDER_CHANNELS = {
  chunk: 'recorder:chunk',
  commandStart: 'recorder:command-start',
  commandStop: 'recorder:command-stop',
  commandListDevices: 'recorder:command-list-devices',
  devices: 'recorder:devices',
  error: 'recorder:error',
  level: 'recorder:level',
  started: 'recorder:started',
  stopped: 'recorder:stopped',
} as const;

export interface RecorderStartMetadata {
  channels: number;
  mimeType: string;
  sampleRateHz: number;
}

export interface RecorderStopMetadata extends RecorderStartMetadata {
  durationMs: number;
  peakLevel: number;
}

export interface RecorderDeviceInfo {
  deviceId: string;
  label: string;
}

export interface RecorderApi {
  onListDevices: (listener: (requestId: string) => void) => void;
  onStart: (
    listener: (
      sessionId: string,
      microphoneDeviceId?: string,
      outputFormat?: ProviderAudioFormat,
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
  sendStarted: (sessionId: string, metadata: RecorderStartMetadata) => void;
  sendStopped: (sessionId: string, metadata: RecorderStopMetadata) => void;
}
import type { ProviderAudioFormat } from '../core/providers/contracts.js';
