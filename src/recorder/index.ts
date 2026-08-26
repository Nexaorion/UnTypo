import type {
  RecorderStartMetadata,
  RecorderStopMetadata,
} from '../shared/recorder-ipc';
import type { ProviderAudioFormat } from '../core/providers/contracts';
import { recorderAudioConstraints } from './device-selection';
import { VoiceActivityDetector } from './voice-activity';
import { BAILIAN_WAV_SAMPLE_RATE_HZ, encodePcm16Wav } from './wav';

interface ActiveRecorder {
  chunks: Blob[];
  failed?: boolean;
  levelMeter?: RecorderLevelMeter;
  mediaRecorder: MediaRecorder;
  metadata: RecorderStartMetadata;
  pendingChunks: Set<Promise<void>>;
  peakLevel: number;
  outputFormat: ProviderAudioFormat;
  sessionId: string;
  startedAt: number;
  stream: MediaStream;
  voiceActivity: VoiceActivityDetector;
}

interface RecorderLevelMeter {
  analyser: AnalyserNode;
  context: AudioContext;
  frequencies: Float32Array<ArrayBuffer>;
  samples: Float32Array<ArrayBuffer>;
  source: MediaStreamAudioSourceNode;
  timer: number;
}

const LEVEL_INTERVAL_MILLISECONDS = 80;

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

const transcodeToWav = async (
  chunks: readonly Blob[],
  mimeType: string,
): Promise<ArrayBuffer> => {
  const encodedAudio = await new Blob([...chunks], {
    type: mimeType,
  }).arrayBuffer();
  const decodingContext = new AudioContext();
  try {
    const decoded = await decodingContext.decodeAudioData(encodedAudio);
    const frameCount = Math.max(
      1,
      Math.ceil(decoded.duration * BAILIAN_WAV_SAMPLE_RATE_HZ),
    );
    const renderingContext = new OfflineAudioContext(
      1,
      frameCount,
      BAILIAN_WAV_SAMPLE_RATE_HZ,
    );
    const source = renderingContext.createBufferSource();
    source.buffer = decoded;
    source.connect(renderingContext.destination);
    source.start();
    const rendered = await renderingContext.startRendering();
    return encodePcm16Wav(
      rendered.getChannelData(0),
      BAILIAN_WAV_SAMPLE_RATE_HZ,
    );
  } finally {
    await decodingContext.close().catch(() => undefined);
  }
};

const closeAudioContext = (context: AudioContext): void => {
  try {
    void context.close().catch(() => undefined);
  } catch {
    // Closing an already-closed context must not affect the recording.
  }
};

const disconnectAudioNode = (node: AudioNode | undefined): void => {
  try {
    node?.disconnect();
  } catch {
    // Cleanup remains best-effort if the audio graph has already disconnected.
  }
};

const stopLevelMeter = (recorder: ActiveRecorder): void => {
  const meter = recorder.levelMeter;
  if (!meter) return;
  recorder.levelMeter = undefined;
  window.clearInterval(meter.timer);
  disconnectAudioNode(meter.source);
  disconnectAudioNode(meter.analyser);
  closeAudioContext(meter.context);
};

const startLevelMeter = (recorder: ActiveRecorder): void => {
  let context: AudioContext | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let analyser: AnalyserNode | undefined;

  try {
    context = new AudioContext();
    source = context.createMediaStreamSource(recorder.stream);
    analyser = context.createAnalyser();
    analyser.fftSize = 2_048;
    source.connect(analyser);

    const samples = new Float32Array(analyser.fftSize);
    const frequencies = new Float32Array(analyser.frequencyBinCount);
    const timer = window.setInterval(() => {
      const meter = recorder.levelMeter;
      if (!meter) return;
      try {
        meter.analyser.getFloatTimeDomainData(meter.samples);
        let sumOfSquares = 0;
        for (const sample of meter.samples) sumOfSquares += sample * sample;
        const rms = Math.sqrt(sumOfSquares / meter.samples.length);
        const level = Math.min(1, Math.max(0, rms * 5));
        recorder.peakLevel = Math.max(recorder.peakLevel, level);
        meter.analyser.getFloatFrequencyData(meter.frequencies);
        recorder.voiceActivity.observe(
          meter.samples,
          meter.frequencies,
          meter.context.sampleRate,
          LEVEL_INTERVAL_MILLISECONDS,
        );
        window.recorder.sendLevel(recorder.sessionId, level);
      } catch {
        stopLevelMeter(recorder);
      }
    }, LEVEL_INTERVAL_MILLISECONDS);

    recorder.levelMeter = {
      analyser,
      context,
      frequencies,
      samples,
      source,
      timer,
    };
    if (context.state === 'suspended') {
      void context.resume().catch(() => {
        if (recorder.levelMeter?.context === context) {
          stopLevelMeter(recorder);
        }
      });
    }
  } catch {
    if (recorder.levelMeter?.context === context) {
      stopLevelMeter(recorder);
      return;
    }
    disconnectAudioNode(source);
    disconnectAudioNode(analyser);
    if (context) closeAudioContext(context);
  }
};

const start = async (
  sessionId: string,
  microphoneDeviceId?: string,
  outputFormat: ProviderAudioFormat = 'webm',
): Promise<void> => {
  if (activeRecorder) {
    window.recorder.sendError(sessionId, 'Recorder is already active');
    return;
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: recorderAudioConstraints(microphoneDeviceId),
    video: false,
  });
  const mimeType = supportedMimeType();
  const mediaRecorder = new MediaRecorder(
    stream,
    mimeType ? { mimeType } : undefined,
  );
  const settings = stream.getAudioTracks()[0]?.getSettings();
  const encodedMimeType = mediaRecorder.mimeType || mimeType || 'audio/webm';
  const metadata: RecorderStartMetadata =
    outputFormat === 'wav'
      ? {
          channels: 1,
          mimeType: 'audio/wav',
          sampleRateHz: BAILIAN_WAV_SAMPLE_RATE_HZ,
        }
      : {
          channels: settings?.channelCount ?? 1,
          mimeType: encodedMimeType,
          sampleRateHz: settings?.sampleRate ?? 48_000,
        };
  const recorder: ActiveRecorder = {
    chunks: [],
    mediaRecorder,
    metadata,
    outputFormat,
    pendingChunks: new Set(),
    peakLevel: 0,
    sessionId,
    startedAt: performance.now(),
    stream,
    voiceActivity: new VoiceActivityDetector(),
  };
  activeRecorder = recorder;

  mediaRecorder.addEventListener('dataavailable', (event) => {
    if (event.data.size === 0) return;
    if (recorder.outputFormat === 'wav') {
      recorder.chunks.push(event.data);
      return;
    }
    const pending = event.data.arrayBuffer().then((chunk) => {
      window.recorder.sendChunk(sessionId, chunk);
    });
    recorder.pendingChunks.add(pending);
    void pending.finally(() => recorder.pendingChunks.delete(pending));
  });

  mediaRecorder.addEventListener('error', (event) => {
    recorder.failed = true;
    recorder.chunks.length = 0;
    stopLevelMeter(recorder);
    stopTracks(recorder.stream);
    if (activeRecorder === recorder) activeRecorder = undefined;
    const message =
      'error' in event && event.error instanceof Error
        ? event.error.message
        : 'MediaRecorder failed';
    window.recorder.sendError(sessionId, message);
  });

  mediaRecorder.addEventListener('stop', () => {
    const durationMs = Math.max(
      1,
      Math.round(performance.now() - recorder.startedAt),
    );
    stopLevelMeter(recorder);
    stopTracks(recorder.stream);
    if (activeRecorder === recorder) activeRecorder = undefined;
    if (recorder.failed) {
      return;
    }
    void (async () => {
      await Promise.all([...recorder.pendingChunks]);
      if (recorder.outputFormat === 'wav') {
        const wav = await transcodeToWav(recorder.chunks, encodedMimeType);
        recorder.chunks.length = 0;
        window.recorder.sendChunk(sessionId, wav);
      }
      const stopped: RecorderStopMetadata = {
        ...recorder.metadata,
        durationMs,
        peakLevel: recorder.peakLevel,
        ...recorder.voiceActivity.snapshot(),
      };
      window.recorder.sendStopped(sessionId, stopped);
    })().catch((error: unknown) => {
      recorder.chunks.length = 0;
      const message =
        error instanceof Error
          ? `Audio conversion failed: ${error.message}`
          : 'Audio conversion failed';
      window.recorder.sendError(sessionId, message);
    });
  });

  mediaRecorder.start(250);
  window.recorder.sendStarted(sessionId, metadata);
  startLevelMeter(recorder);
};

const stop = (sessionId: string): void => {
  if (!activeRecorder || activeRecorder.sessionId !== sessionId) {
    window.recorder.sendError(sessionId, 'Recorder session is not active');
    return;
  }
  stopLevelMeter(activeRecorder);
  if (activeRecorder.mediaRecorder.state !== 'inactive') {
    activeRecorder.mediaRecorder.stop();
  }
};

window.recorder.onListDevices((requestId) => {
  void navigator.mediaDevices
    .enumerateDevices()
    .then((devices) => {
      const inputs = devices
        .filter(({ kind }) => kind === 'audioinput')
        .map(({ deviceId, label }, index) => ({
          deviceId,
          label: label.trim() || `Microphone ${String(index + 1)}`,
        }));
      window.recorder.sendDevices(requestId, inputs);
    })
    .catch((error: unknown) => {
      const message =
        error instanceof Error ? error.message : 'Unable to list microphones';
      window.recorder.sendDevices(requestId, [], message);
    });
});

window.recorder.onStart((sessionId, microphoneDeviceId, outputFormat) => {
  void start(sessionId, microphoneDeviceId, outputFormat).catch(
    (error: unknown) => {
      const message =
        error instanceof Error ? error.message : 'Microphone failed';
      window.recorder.sendError(sessionId, message);
      if (activeRecorder?.sessionId === sessionId) {
        stopLevelMeter(activeRecorder);
        stopTracks(activeRecorder.stream);
        activeRecorder = undefined;
      }
    },
  );
});

window.recorder.onStop(stop);
