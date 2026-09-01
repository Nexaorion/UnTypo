import { describe, expect, it, vi } from 'vitest';
import type {
  AudioPayload,
  DictationIntent,
  ProviderAudioFormat,
  RealtimeTranscriptionSession,
} from '../../src/core/providers/contracts';
import { MockDictationProvider } from '../../src/core/providers/mock-provider';
import {
  SpeechProviderRegistry,
  TextProviderRegistry,
} from '../../src/core/providers/registry';
import {
  DictationCoordinator,
  type HistoryPort,
} from '../../src/main/dictation/coordinator';
import { NativeHotkeyAction } from '../../src/main/native/protocol';
import type { NativeTargetSnapshot } from '../../src/main/native/protocol';
import type { CapsuleErrorReason } from '../../src/shared/capsule-ipc';
import type { DiagnosticIssueInput } from '../../src/main/diagnostics/collector';
import type { DictionaryCandidate } from '../../src/shared/dictionary';
import { DEFAULT_APPLICATION_WRITING_STYLES } from '../../src/shared/personalization';
import type { WritingPreferenceCandidate } from '../../src/shared/personalization';

const target: NativeTargetSnapshot = {
  editable: true,
  higherIntegrity: false,
  processId: 42,
  windowHandle: '4660',
};

const audio: AudioPayload = {
  bytes: new Uint8Array(2_048),
  channels: 1,
  durationMs: 500,
  mimeType: 'audio/webm',
  sampleRateHz: 48_000,
};

interface RuntimeOptions {
  dictionaryCandidates?: readonly DictionaryCandidate[];
  injected?: boolean;
  microphoneDeviceId?: string;
  microphoneDeviceLabel?: string;
  preferredAudioFormat?: ProviderAudioFormat;
  preferenceCandidates?: readonly WritingPreferenceCandidate[];
  realtimeFailure?: Error;
  realtimeTranscript?: string;
  signal?: AbortSignal;
  speechProviderId?: string;
  targetSnapshot?: NativeTargetSnapshot;
  transcript?: string;
  intent?: DictationIntent;
  withTextProvider?: boolean;
}

const createCoordinator = ({
  dictionaryCandidates,
  injected = true,
  microphoneDeviceId,
  microphoneDeviceLabel,
  preferredAudioFormat,
  preferenceCandidates,
  realtimeFailure,
  realtimeTranscript,
  signal,
  speechProviderId = 'mock',
  targetSnapshot = target,
  transcript = 'raw mock result',
  intent,
  withTextProvider = true,
}: RuntimeOptions = {}) => {
  const speechProviders = new SpeechProviderRegistry();
  const textProviders = new TextProviderRegistry();
  const provider = new MockDictationProvider({
    ...(dictionaryCandidates ? { dictionaryCandidates } : {}),
    ...(intent ? { intent } : {}),
    polishedText: 'Final mock result',
    ...(preferenceCandidates ? { preferenceCandidates } : {}),
    transcript,
  });
  if (preferredAudioFormat) {
    Object.assign(provider, { preferredAudioFormat });
  }
  const appendRealtimeAudio = vi.fn();
  const abortRealtime = vi.fn();
  const finishRealtime = vi.fn(() =>
    realtimeFailure
      ? Promise.reject(realtimeFailure)
      : Promise.resolve({
          language: 'en-US' as const,
          text: realtimeTranscript ?? '',
          usage: { audioDurationMs: audio.durationMs },
        }),
  );
  if (realtimeTranscript !== undefined || realtimeFailure) {
    const realtimeSession: RealtimeTranscriptionSession = {
      abort: abortRealtime,
      appendAudio: appendRealtimeAudio,
      finish: finishRealtime,
    };
    Object.assign(provider, {
      createRealtimeTranscriptionSession: () => realtimeSession,
      realtimeAudioConfiguration: {
        channels: 1,
        mimeType: 'audio/pcm',
        sampleRateHz: 16_000,
      },
    });
  }
  speechProviders.register(provider);
  textProviders.register(provider);

  const events: string[] = [];
  const showError = vi.fn((reason: CapsuleErrorReason) => {
    events.push(`error:${reason}`);
  });
  const showConfirm = vi.fn(() => true);
  const showProcessing = vi.fn(() => events.push('processing'));
  const showRecording = vi.fn(() => events.push('recording'));
  const showSuccess = vi.fn(
    (_result: unknown, delivery: 'copy' | 'inserted') => {
      events.push(`success:${delivery}`);
      return 7;
    },
  );
  const updateProcessing = vi.fn();
  const handleCandidates = vi.fn();
  const handlePreferenceCandidates = vi.fn();
  const record = vi.fn<HistoryPort['record']>();
  const start = vi.fn(() => Promise.resolve('recording-session'));
  const stop = vi.fn(() =>
    Promise.resolve({
      audio,
      peakLevel: 0.45,
      sessionId: 'recording-session',
      target: targetSnapshot,
      speechDurationMs: 320,
      voiceDetected: true,
    }),
  );
  const inject = vi.fn(() => Promise.resolve({ injected }));
  const getContext = vi.fn(() => ({
    applicationStyles: DEFAULT_APPLICATION_WRITING_STYLES,
    history: { enabled: true, retentionDays: 30 },
    learnedPreferences: [],
    modelName: 'whisper-1',
    ...(microphoneDeviceId
      ? {
          microphoneSelection: {
            deviceId: microphoneDeviceId,
            ...(microphoneDeviceLabel ? { label: microphoneDeviceLabel } : {}),
          },
        }
      : {}),
    options: {
      defaultTargetLanguage: 'en-US' as const,
      dictionary: [],
      dictionaryLearningEnabled: true,
      language: 'en-US' as const,
      ...(signal ? { signal } : {}),
    },
    preferenceLearningEnabled: true,
    speechProviderId,
    speechProviderDetails: {
      modelName: 'whisper-1',
      providerName: 'Mock speech',
      providerType: 'openai-compatible-speech' as const,
    },
    ...(withTextProvider ? { textProviderId: 'mock' } : {}),
    ...(withTextProvider
      ? {
          textProviderDetails: {
            modelName: 'mock-text',
            providerName: 'Mock text',
            providerType: 'openai-compatible-text' as const,
          },
        }
      : {}),
    uiLanguage: 'en-US' as const,
  }));
  const diagnosticLog = vi.fn();
  const recordIssue = vi.fn<(input: DiagnosticIssueInput) => void>();
  const runWithOperation = vi.fn(
    <T>(_operationId: string, action: () => Promise<T>) => action(),
  );
  const coordinator = new DictationCoordinator({
    diagnostics: {
      log: diagnosticLog,
      recordIssue,
      runWithOperation,
    },
    dictionaryLearning: { handleCandidates },
    getContext,
    history: { record },
    injection: { inject },
    native: { captureTarget: () => Promise.resolve(targetSnapshot) },
    presenter: {
      showConfirm,
      showError,
      showProcessing,
      showRecording,
      showSuccess,
      updateProcessing,
    },
    preferenceLearning: { handleCandidates: handlePreferenceCandidates },
    recorder: { start, stop },
    speechProviders,
    textProviders,
  });
  return {
    coordinator,
    abortRealtime,
    appendRealtimeAudio,
    diagnosticLog,
    events,
    finishRealtime,
    getContext,
    handleCandidates,
    handlePreferenceCandidates,
    inject,
    provider,
    record,
    recordIssue,
    runWithOperation,
    showError,
    showConfirm,
    showProcessing,
    showRecording,
    showSuccess,
    start,
    stop,
    updateProcessing,
  };
};

type TextFailureSetup = (
  provider: MockDictationProvider,
  failure: Error,
) => void;

const textFailureCases: ReadonlyArray<readonly [string, TextFailureSetup]> = [
  [
    'one-pass processing',
    (provider, failure) => {
      vi.spyOn(provider, 'processTranscript').mockRejectedValueOnce(failure);
    },
  ],
];

describe('DictationCoordinator', () => {
  it('uses realtime audio captured during recording without a second ASR call', async () => {
    const runtime = createCoordinator({
      realtimeTranscript: 'Realtime raw result',
      withTextProvider: false,
    });
    const transcribe = vi.spyOn(runtime.provider, 'transcribe');

    await runtime.coordinator.handleHotkey(NativeHotkeyAction.Toggle);
    const realtimeSink = runtime.start.mock.calls[0]?.[3];
    expect(realtimeSink).toBeTypeOf('function');
    realtimeSink?.(new Uint8Array([1, 2, 3, 4]));
    await runtime.coordinator.handleHotkey(NativeHotkeyAction.Toggle);

    expect(runtime.appendRealtimeAudio).toHaveBeenCalledWith(
      new Uint8Array([1, 2, 3, 4]),
    );
    expect(runtime.finishRealtime).toHaveBeenCalledWith(audio.durationMs);
    expect(transcribe).not.toHaveBeenCalled();
    expect(runtime.inject).toHaveBeenCalledWith('Realtime raw result', target);
  });

  it('falls back to synchronous ASR when realtime recognition fails', async () => {
    const runtime = createCoordinator({
      realtimeFailure: new Error('socket unavailable'),
      withTextProvider: false,
    });
    const transcribe = vi.spyOn(runtime.provider, 'transcribe');

    await runtime.coordinator.handleHotkey(NativeHotkeyAction.Toggle);
    await runtime.coordinator.handleHotkey(NativeHotkeyAction.Toggle);

    expect(transcribe).toHaveBeenCalledOnce();
    expect(runtime.inject).toHaveBeenCalledWith('raw mock result', target);
    const realtimeIssue = runtime.recordIssue.mock.calls.find(
      ([issue]) => issue.source === 'provider.realtime-speech',
    )?.[0];
    expect(realtimeIssue).toMatchObject({
      context: { fallbackUsed: true },
      source: 'provider.realtime-speech',
    });
  });

  it('runs recording, processing, insertion, and history end to end', async () => {
    const runtime = createCoordinator({
      microphoneDeviceId: 'microphone-1',
      microphoneDeviceLabel: 'USB Microphone',
    });

    await runtime.coordinator.handleHotkey(NativeHotkeyAction.Toggle);
    expect(runtime.coordinator.state).toBe('recording');
    await runtime.coordinator.handleHotkey(NativeHotkeyAction.Toggle);

    expect(runtime.start).toHaveBeenCalledWith(
      {
        processId: 42,
        windowHandle: '4660',
      },
      { deviceId: 'microphone-1', label: 'USB Microphone' },
      'webm',
    );
    expect(runtime.getContext).toHaveBeenCalledTimes(1);
    expect(runtime.inject).toHaveBeenCalledWith('Final mock result', target);
    expect(runtime.updateProcessing).toHaveBeenCalledWith('Final mock result');
    expect(runtime.events).toEqual([
      'recording',
      'processing',
      'success:inserted',
    ]);
    expect(runtime.record).toHaveBeenCalledWith(
      expect.objectContaining({
        audioDurationMs: 500,
        intent: 'transcription',
        modelName: 'whisper-1',
        outputText: 'Final mock result',
        rawTranscript: 'raw mock result',
      }),
      { enabled: true, retentionDays: 30 },
    );
    const trace = runtime.record.mock.calls[0]?.[0].processingTrace;
    expect(trace?.modelCalls).toHaveLength(2);
    expect(trace?.modelCalls[0]).toMatchObject({
      kind: 'speech-recognition',
      modelName: 'whisper-1',
      outputText: 'raw mock result',
    });
    const textCall = trace?.modelCalls[1];
    expect(textCall).toMatchObject({
      kind: 'text-generation',
      modelName: 'mock-text',
      outputText: 'Final mock result',
    });
    expect(textCall?.firstOutputMs).toBeTypeOf('number');
    expect(
      textCall?.kind === 'text-generation' ? textCall.input.text : undefined,
    ).toBe('raw mock result');
    expect(trace?.injectionMs).toBeTypeOf('number');
    expect(trace?.modelProcessingMs).toBeTypeOf('number');
    expect(trace?.operationId).toBeTypeOf('string');
    expect(trace?.recorderFinalizationMs).toBeTypeOf('number');
    expect(trace?.totalDurationMs).toBeTypeOf('number');
    expect(runtime.coordinator.state).toBe('idle');
  });

  it('dispatches model candidates after the success capsule is visible', async () => {
    const candidate: DictionaryCandidate = {
      category: 'product',
      confidence: 0.95,
      term: 'UnTypo',
    };
    const preferenceCandidate: WritingPreferenceCandidate = {
      confidence: 0.95,
      kind: 'tone',
      value: 'polite',
    };
    const runtime = createCoordinator({
      dictionaryCandidates: [candidate],
      preferenceCandidates: [preferenceCandidate],
    });

    await runtime.coordinator.start();
    await runtime.coordinator.stop();

    expect(runtime.handleCandidates).toHaveBeenCalledWith([candidate], 7);
    expect(runtime.handlePreferenceCandidates).toHaveBeenCalledWith(
      [preferenceCandidate],
      { kind: 'general' },
    );
    expect(runtime.events.at(-1)).toBe('success:inserted');
  });

  it('forces detected Codex requests into prompt transcription', async () => {
    const codexTarget: NativeTargetSnapshot = {
      ...target,
      processName: 'ChatGPT.exe',
      windowTitle: 'ChatGPT',
    };
    const runtime = createCoordinator({
      intent: 'instruction',
      targetSnapshot: codexTarget,
      transcript: '帮我生成一个 SECURITY.md 并推送到 GitHub',
    });
    const processTranscript = vi.spyOn(runtime.provider, 'processTranscript');

    await runtime.coordinator.start();
    await runtime.coordinator.stop();

    expect(processTranscript).toHaveBeenCalledOnce();
    expect(processTranscript.mock.calls[0]?.[0]).toBe(
      '帮我生成一个 SECURITY.md 并推送到 GitHub',
    );
    expect(processTranscript.mock.calls[0]?.[1]).toMatchObject({
      forcedIntent: 'transcription',
      writingStyle: 'prompt',
      windowContext: {
        application: { kind: 'ai-tool', name: 'ChatGPT/Codex' },
      },
    });
    expect(
      processTranscript.mock.calls[0]?.[1].windowContext,
    ).not.toHaveProperty('windowTitle');
    expect(runtime.record).toHaveBeenCalledWith(
      expect.objectContaining({ intent: 'transcription' }),
      expect.anything(),
    );
    expect(runtime.showConfirm).not.toHaveBeenCalled();
  });

  it('requests the speech provider preferred recording format', async () => {
    const runtime = createCoordinator({ preferredAudioFormat: 'wav' });

    await runtime.coordinator.start();

    expect(runtime.start).toHaveBeenCalledWith(
      { processId: 42, windowHandle: '4660' },
      undefined,
      'wav',
    );
  });

  it('keeps a copyable result when automatic insertion returns false', async () => {
    const runtime = createCoordinator({ injected: false });

    await runtime.coordinator.handleHotkey(NativeHotkeyAction.Toggle);
    await runtime.coordinator.handleHotkey(NativeHotkeyAction.Toggle);

    expect(runtime.showSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ outputText: 'Final mock result' }),
      'copy',
    );
    expect(runtime.events).toEqual(['recording', 'processing', 'success:copy']);
    expect(runtime.coordinator.state).toBe('idle');
  });

  it('keeps a copyable result when automatic insertion throws', async () => {
    const runtime = createCoordinator();
    runtime.inject.mockRejectedValueOnce(new Error('paste failed'));
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    await runtime.coordinator.handleHotkey(NativeHotkeyAction.Toggle);
    await runtime.coordinator.handleHotkey(NativeHotkeyAction.Toggle);

    expect(runtime.events.at(-1)).toBe('success:copy');
    expect(runtime.record).toHaveBeenCalledOnce();
    expect(consoleError).toHaveBeenCalledWith(
      'Dictation injection failed',
      expect.any(Error),
    );
    consoleError.mockRestore();
  });

  it('injects the raw transcript when no text provider is active', async () => {
    const runtime = createCoordinator({ withTextProvider: false });

    await runtime.coordinator.handleHotkey(NativeHotkeyAction.Toggle);
    await runtime.coordinator.handleHotkey(NativeHotkeyAction.Toggle);

    expect(runtime.inject).toHaveBeenCalledWith('raw mock result', target);
    expect(runtime.record).toHaveBeenCalledWith(
      expect.objectContaining({
        outputText: 'raw mock result',
        providerId: 'mock',
        rawTranscript: 'raw mock result',
      }),
      { enabled: true, retentionDays: 30 },
    );
  });

  it.each(textFailureCases)(
    'delivers the raw transcript when text %s fails',
    async (_stage, configureFailure) => {
      const runtime = createCoordinator();
      const failure = new Error('text provider unavailable');
      configureFailure(runtime.provider, failure);
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      await runtime.coordinator.start();
      await runtime.coordinator.stop();

      expect(runtime.inject).toHaveBeenCalledWith('raw mock result', target);
      expect(runtime.record).toHaveBeenCalledWith(
        expect.objectContaining({
          intent: 'transcription',
          outputText: 'raw mock result',
          rawTranscript: 'raw mock result',
        }),
        { enabled: true, retentionDays: 30 },
      );
      expect(runtime.showSuccess).toHaveBeenCalledWith(
        expect.objectContaining({
          intent: 'transcription',
          outputText: 'raw mock result',
          rawTranscript: 'raw mock result',
        }),
        'inserted',
      );
      expect(runtime.showError).not.toHaveBeenCalled();
      expect(runtime.events).toEqual([
        'recording',
        'processing',
        'success:inserted',
      ]);
      expect(consoleError).toHaveBeenCalledWith(
        'Dictation text post-processing failed; using raw transcript',
        failure,
      );
      expect(runtime.coordinator.state).toBe('idle');
      consoleError.mockRestore();
    },
  );

  it('shows configuration errors before starting the microphone', async () => {
    const runtime = createCoordinator({ speechProviderId: 'missing' });

    await expect(runtime.coordinator.start()).rejects.toThrow(
      'Provider missing is not registered',
    );

    expect(runtime.events).toEqual(['error:configuration']);
    expect(runtime.start).not.toHaveBeenCalled();
    expect(runtime.coordinator.state).toBe('idle');
  });

  it('shows microphone errors and can start again after a failed attempt', async () => {
    const runtime = createCoordinator();
    runtime.start.mockRejectedValueOnce(new Error('microphone denied'));

    await expect(runtime.coordinator.start()).rejects.toThrow(
      'microphone denied',
    );
    expect(runtime.events).toEqual(['error:microphone']);
    expect(runtime.coordinator.state).toBe('idle');

    await runtime.coordinator.start();
    expect(runtime.events.at(-1)).toBe('recording');
    expect(runtime.coordinator.state).toBe('recording');
  });

  it('keeps speech-provider failures hard', async () => {
    const runtime = createCoordinator();
    vi.spyOn(runtime.provider, 'transcribe').mockRejectedValueOnce(
      new Error('speech unavailable'),
    );

    await runtime.coordinator.start();
    await expect(runtime.coordinator.stop()).rejects.toThrow(
      'speech unavailable',
    );

    expect(runtime.events).toEqual([
      'recording',
      'processing',
      'error:provider',
    ]);
    expect(runtime.inject).not.toHaveBeenCalled();
    expect(runtime.record).not.toHaveBeenCalled();
    expect(runtime.recordIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        audio,
        kind: 'provider',
        source: 'provider.speech-processing',
      }),
    );
    expect(runtime.showSuccess).not.toHaveBeenCalled();
    expect(runtime.coordinator.state).toBe('idle');
  });

  it('stops before the provider when the microphone records no signal', async () => {
    const runtime = createCoordinator();
    const transcribe = vi.spyOn(runtime.provider, 'transcribe');
    runtime.stop.mockResolvedValueOnce({
      audio: { ...audio, bytes: new Uint8Array(447) },
      peakLevel: 0,
      sessionId: 'recording-session',
      target,
      speechDurationMs: 0,
      voiceDetected: false,
    });

    await runtime.coordinator.start();
    await expect(runtime.coordinator.stop()).rejects.toThrow(
      'No microphone signal was detected',
    );

    expect(runtime.showError).toHaveBeenLastCalledWith(
      'microphone',
      'No microphone signal detected. Choose another microphone in Settings.',
    );
    expect(transcribe).not.toHaveBeenCalled();
    const signalIssue = runtime.recordIssue.mock.calls.find(
      ([issue]) => issue.source === 'recorder.signal',
    )?.[0];
    expect(signalIssue).toMatchObject({
      kind: 'microphone',
      source: 'recorder.signal',
    });
    expect(signalIssue?.audio?.durationMs).toBe(500);
    expect(runtime.coordinator.state).toBe('idle');
  });

  it('does not call the speech provider when local voice activity is absent', async () => {
    const runtime = createCoordinator();
    const transcribe = vi.spyOn(runtime.provider, 'transcribe');
    runtime.stop.mockResolvedValueOnce({
      audio,
      peakLevel: 0.08,
      sessionId: 'recording-session',
      target,
      speechDurationMs: 0,
      voiceDetected: false,
    });

    await runtime.coordinator.start();
    await runtime.coordinator.stop();

    expect(transcribe).not.toHaveBeenCalled();
    expect(runtime.showError).toHaveBeenCalledWith('no-speech');
    expect(runtime.recordIssue).not.toHaveBeenCalled();
    expect(runtime.coordinator.state).toBe('idle');
  });

  it('shows an empty-result error and resets to idle', async () => {
    const runtime = createCoordinator({ transcript: '   ' });

    await runtime.coordinator.start();
    await expect(runtime.coordinator.stop()).rejects.toThrow(
      'empty transcript',
    );

    expect(runtime.events).toEqual(['recording', 'processing', 'error:empty']);
    expect(runtime.showSuccess).not.toHaveBeenCalled();
    expect(runtime.coordinator.state).toBe('idle');
  });

  it('keeps aborted processing hard', async () => {
    const controller = new AbortController();
    controller.abort();
    const runtime = createCoordinator({ signal: controller.signal });

    await runtime.coordinator.start();
    await expect(runtime.coordinator.stop()).rejects.toMatchObject({
      code: 'ABORTED',
    });

    expect(runtime.events).toEqual([
      'recording',
      'processing',
      'error:provider',
    ]);
    expect(runtime.inject).not.toHaveBeenCalled();
    expect(runtime.record).not.toHaveBeenCalled();
    expect(runtime.showSuccess).not.toHaveBeenCalled();
    expect(runtime.coordinator.state).toBe('idle');
  });

  it('does not replace a successful result when history persistence fails', async () => {
    const runtime = createCoordinator();
    runtime.record.mockImplementationOnce(() => {
      throw new Error('database unavailable');
    });
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    await runtime.coordinator.start();
    await runtime.coordinator.stop();

    expect(runtime.events.at(-1)).toBe('success:inserted');
    expect(runtime.showError).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(
      'Dictation history write failed',
      expect.any(Error),
    );
    consoleError.mockRestore();
  });
});
