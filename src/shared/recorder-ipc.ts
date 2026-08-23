export const RECORDER_CHANNELS = {
  chunk: 'recorder:chunk',
  commandStart: 'recorder:command-start',
  commandStop: 'recorder:command-stop',
  error: 'recorder:error',
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
}

export interface RecorderApi {
  onStart: (listener: (sessionId: string) => void) => void;
  onStop: (listener: (sessionId: string) => void) => void;
  sendChunk: (sessionId: string, chunk: ArrayBuffer) => void;
  sendError: (sessionId: string, message: string) => void;
  sendStarted: (sessionId: string, metadata: RecorderStartMetadata) => void;
  sendStopped: (sessionId: string, metadata: RecorderStopMetadata) => void;
}
