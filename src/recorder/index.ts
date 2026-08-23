import type {
  RecorderStartMetadata,
  RecorderStopMetadata,
} from '../shared/recorder-ipc';

interface ActiveRecorder {
  mediaRecorder: MediaRecorder;
  metadata: RecorderStartMetadata;
  pendingChunks: Set<Promise<void>>;
  sessionId: string;
  startedAt: number;
  stream: MediaStream;
}

let activeRecorder: ActiveRecorder | undefined;

const supportedMimeType = (): string | undefined => {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm'];
  return candidates.find((candidate) =>
    MediaRecorder.isTypeSupported(candidate),
  );
};

const stopTracks = (stream: MediaStream): void => {
  for (const track of stream.getTracks()) track.stop();
};

const start = async (sessionId: string): Promise<void> => {
  if (activeRecorder) {
    window.recorder.sendError(sessionId, 'Recorder is already active');
    return;
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      autoGainControl: true,
      echoCancellation: true,
      noiseSuppression: true,
    },
    video: false,
  });
  const mimeType = supportedMimeType();
  const mediaRecorder = new MediaRecorder(
    stream,
    mimeType ? { mimeType } : undefined,
  );
  const settings = stream.getAudioTracks()[0]?.getSettings();
  const metadata: RecorderStartMetadata = {
    channels: settings?.channelCount ?? 1,
    mimeType: mediaRecorder.mimeType || mimeType || 'audio/webm',
    sampleRateHz: settings?.sampleRate ?? 48_000,
  };
  const recorder: ActiveRecorder = {
    mediaRecorder,
    metadata,
    pendingChunks: new Set(),
    sessionId,
    startedAt: performance.now(),
    stream,
  };
  activeRecorder = recorder;

  mediaRecorder.addEventListener('dataavailable', (event) => {
    if (event.data.size === 0) return;
    const pending = event.data.arrayBuffer().then((chunk) => {
      window.recorder.sendChunk(sessionId, chunk);
    });
    recorder.pendingChunks.add(pending);
    void pending.finally(() => recorder.pendingChunks.delete(pending));
  });

  mediaRecorder.addEventListener('error', (event) => {
    const message =
      'error' in event && event.error instanceof Error
        ? event.error.message
        : 'MediaRecorder failed';
    window.recorder.sendError(sessionId, message);
  });

  mediaRecorder.addEventListener('stop', () => {
    void Promise.all([...recorder.pendingChunks]).then(() => {
      const stopped: RecorderStopMetadata = {
        ...recorder.metadata,
        durationMs: Math.max(
          1,
          Math.round(performance.now() - recorder.startedAt),
        ),
      };
      stopTracks(recorder.stream);
      if (activeRecorder === recorder) activeRecorder = undefined;
      window.recorder.sendStopped(sessionId, stopped);
    });
  });

  mediaRecorder.start(250);
  window.recorder.sendStarted(sessionId, metadata);
};

const stop = (sessionId: string): void => {
  if (!activeRecorder || activeRecorder.sessionId !== sessionId) {
    window.recorder.sendError(sessionId, 'Recorder session is not active');
    return;
  }
  if (activeRecorder.mediaRecorder.state !== 'inactive') {
    activeRecorder.mediaRecorder.stop();
  }
};

window.recorder.onStart((sessionId) => {
  void start(sessionId).catch((error: unknown) => {
    const message =
      error instanceof Error ? error.message : 'Microphone failed';
    window.recorder.sendError(sessionId, message);
    if (activeRecorder?.sessionId === sessionId) {
      stopTracks(activeRecorder.stream);
      activeRecorder = undefined;
    }
  });
});

window.recorder.onStop(stop);
