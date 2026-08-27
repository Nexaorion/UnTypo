import { describe, expect, it, vi } from 'vitest';
import type {
  AudioPayload,
  ProviderAudioFormat,
} from '../../src/core/providers/contracts';
import { MockDictationProvider } from '../../src/core/providers/mock-provider';
import {
  SpeechProviderRegistry,
  TextProviderRegistry,
} from '../../src/core/providers/registry';
import { DictationCoordinator } from '../../src/main/dictation/coordinator';
import { NativeHotkeyAction } from '../../src/main/native/protocol';
import type { NativeTargetSnapshot } from '../../src/main/native/protocol';
import type { CapsuleErrorReason } from '../../src/shared/capsule-ipc';
import type { DiagnosticIssueInput } from '../../src/main/diagnostics/collector';
import type { DictionaryCandidate } from '../../src/shared/dictionary';

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
  preferredAudioFormat?: ProviderAudioFormat;
  signal?: AbortSignal;
  speechProviderId?: string;
  transcript?: string;
  withTextProvider?: boolean;
}

const createCoordinator = ({
  dictionaryCandidates,
  injected = true,
  microphoneDeviceId,
  preferredAudioFormat,
  signal,
  speechProviderId = 'mock',
  transcript = 'raw mock result',
  withTextProvider = true,
}: RuntimeOptions = {}) => {
  const speechProviders = new SpeechProviderRegistry();
  const textProviders = new TextProviderRegistry();
  const provider = new MockDictationProvider({
    ...(dictionaryCandidates ? { dictionaryCandidates } : {}),
    polishedText: 'Final mock result',
    transcript,
  });
  if (preferredAudioFormat) {
    Object.assign(provider, { preferredAudioFormat });
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
  const handleCandidates = vi.fn();
  const record = vi.fn();
  const start = vi.fn(() => Promise.resolve('recording-session'));
  const stop = vi.fn(() =>
    Promise.resolve({
      audio,
      peakLevel: 0.45,
      sessionId: 'recording-session',
      target,
      speechDurationMs: 320,
      voiceDetected: true,
    }),
  );
  const inject = vi.fn(() => Promise.resolve({ injected }));
  const getContext = vi.fn(() => ({
    history: { enabled: true, retentionDays: 30 },
    modelName: 'whisper-1',
    ...(microphoneDeviceId ? { microphoneDeviceId } : {}),
    options: {
      defaultTargetLanguage: 'en-US' as const,
      dictionary: [],
      dictionaryLearningEnabled: true,
      language: 'en-US' as const,
      ...(signal ? { signal } : {}),
    },
    speechProviderId,
    ...(withTextProvider ? { textProviderId: 'mock' } : {}),
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
    native: { captureTarget: () => Promise.resolve(target) },
    presenter: {
      showConfirm,
      showError,
      showProcessing,
      showRecording,
      showSuccess,
    },
    recorder: { start, stop },
    speechProviders,
    textProviders,
  });
  return {
    coordinator,
    diagnosticLog,
    events,
    getContext,
    handleCandidates,
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
  it('runs recording, processing, insertion, and history end to end', async () => {
    const runtime = createCoordinator({ microphoneDeviceId: 'microphone-1' });

    await runtime.coordinator.handleHotkey(NativeHotkeyAction.Toggle);
    expect(runtime.coordinator.state).toBe('recording');
    await runtime.coordinator.handleHotkey(NativeHotkeyAction.Toggle);

    expect(runtime.start).toHaveBeenCalledWith(
      {
        processId: 42,
        windowHandle: '4660',
      },
      'microphone-1',
      'webm',
    );
    expect(runtime.getContext).toHaveBeenCalledTimes(1);
    expect(runtime.inject).toHaveBeenCalledWith('Final mock result', target);
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
    expect(runtime.coordinator.state).toBe('idle');
  });

  it('dispatches model candidates after the success capsule is visible', async () => {
    const candidate: DictionaryCandidate = {
      category: 'product',
      confidence: 0.95,
      term: 'UnTypo',
    };
    const runtime = createCoordinator({ dictionaryCandidates: [candidate] });

    await runtime.coordinator.start();
    await runtime.coordinator.stop();

    expect(runtime.handleCandidates).toHaveBeenCalledWith([candidate], 7);
    expect(runtime.events.at(-1)).toBe('success:inserted');
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
