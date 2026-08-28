import { describe, expect, it, vi } from 'vitest';
import {
  type AudioPayload,
  type ProcessOptions,
  type ProviderContractError,
} from '../../src/core/providers/contracts';
import { MockDictationProvider } from '../../src/core/providers/mock-provider';
import {
  DictationPipeline,
  RecoverablePostProcessingError,
} from '../../src/core/providers/pipeline';

const audio: AudioPayload = {
  bytes: new Uint8Array([1]),
  channels: 1,
  durationMs: 500,
  mimeType: 'audio/webm',
  sampleRateHz: 48_000,
};

const options: ProcessOptions = {
  defaultTargetLanguage: 'zh-CN',
  dictionary: ['UnTypo'],
  language: 'en-US',
};

const expectRecoverableRawTranscript = async (
  operation: Promise<unknown>,
  cause: unknown,
): Promise<void> => {
  let thrown: unknown;
  try {
    await operation;
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(RecoverablePostProcessingError);
  expect(thrown).toMatchObject({
    fallbackResult: {
      intent: 'transcription',
      modelCalls: [
        { kind: 'speech-recognition', status: 'success' },
        {
          error: 'text processing unavailable',
          kind: 'text-generation',
          status: 'failed',
        },
      ],
      outputText: 'raw transcript',
      rawTranscript: 'raw transcript',
      usage: { audioDurationMs: 500 },
    },
  });
  expect((thrown as RecoverablePostProcessingError).cause).toBe(cause);
};

describe('DictationPipeline', () => {
  it('processes intent and final text in one text-model call', async () => {
    const provider = new MockDictationProvider({
      intent: 'translation',
      transcript: 'hello',
      translatedText: { 'en-US': 'Hello', 'zh-CN': '你好' },
    });
    const processTranscript = vi.spyOn(provider, 'processTranscript');

    const result = await new DictationPipeline(provider, provider).process(
      audio,
      {
        ...options,
        explicitTargetLanguage: 'en-US',
        writingStyle: 'concise',
      },
    );

    expect(result).toMatchObject({
      intent: 'translation',
      modelCalls: [
        {
          input: {
            audioDurationMs: 500,
            dictionaryTermCount: 1,
            payloadSizeBytes: 1,
          },
          kind: 'speech-recognition',
          outputText: 'hello',
          providerId: 'mock',
          status: 'success',
        },
        {
          input: {
            dictionaryTermCount: 1,
            explicitTargetLanguage: 'en-US',
            text: 'hello',
            writingStyle: 'concise',
          },
          kind: 'text-generation',
          outputText: 'Hello',
          providerId: 'mock',
          status: 'success',
        },
      ],
      outputText: 'Hello',
      rawTranscript: 'hello',
    });
    expect(result.modelCalls?.[1]?.firstOutputMs).toBeTypeOf('number');
    expect(processTranscript).toHaveBeenCalledOnce();
    expect(processTranscript).toHaveBeenCalledWith(
      'hello',
      expect.objectContaining({
        explicitTargetLanguage: 'en-US',
        writingStyle: 'concise',
      }),
    );
  });

  it('uses a spoken translation target inside the one-pass processor', async () => {
    const provider = new MockDictationProvider({
      explicitTargetLanguage: 'en-US',
      intent: 'translation',
      transcript: '请翻译成英文：你好',
      translatedText: { 'en-US': 'Hello', 'zh-CN': '你好' },
    });

    await expect(
      new DictationPipeline(provider, provider).process(audio, options),
    ).resolves.toMatchObject({ intent: 'translation', outputText: 'Hello' });
  });

  it('returns enabled learning candidates from the same text-model call', async () => {
    const dictionaryCandidate = {
      category: 'product' as const,
      confidence: 0.95,
      term: 'UnTypo',
    };
    const provider = new MockDictationProvider({
      dictionaryCandidates: [dictionaryCandidate],
      preferenceCandidates: [
        { confidence: 0.95, kind: 'tone', value: 'polite' },
      ],
      transcript: 'Use UnTypo',
    });

    await expect(
      new DictationPipeline(provider, provider).process(audio, {
        ...options,
        dictionaryLearningEnabled: true,
        preferenceLearningEnabled: true,
      }),
    ).resolves.toMatchObject({
      dictionaryCandidates: [dictionaryCandidate],
      outputText: 'Use UnTypo',
      preferenceCandidates: [
        { confidence: 0.95, kind: 'tone', value: 'polite' },
      ],
    });
  });

  it('forces providers without intent detection to transcription', async () => {
    const provider = new MockDictationProvider(
      {
        intent: 'instruction',
        polishedText: 'Polished transcript',
        transcript: 'raw transcript',
      },
      { intentDetection: false },
    );

    await expect(
      new DictationPipeline(provider, provider).process(audio, options),
    ).resolves.toMatchObject({
      intent: 'transcription',
      outputText: 'Polished transcript',
    });
  });

  it('honors a forced intent through the same processor outside fast mode', async () => {
    const provider = new MockDictationProvider({
      intent: 'translation',
      polishedText: 'Plain transcript',
      transcript: 'raw transcript',
    });
    const processTranscript = vi.spyOn(provider, 'processTranscript');

    await expect(
      new DictationPipeline(provider, provider).process(audio, {
        ...options,
        forcedIntent: 'transcription',
      }),
    ).resolves.toMatchObject({
      intent: 'transcription',
      outputText: 'Plain transcript',
    });
    expect(processTranscript).toHaveBeenCalledWith(
      'raw transcript',
      expect.objectContaining({ forcedIntent: 'transcription' }),
    );
  });

  it('does not send personal profile context to BYOK providers', async () => {
    const provider = new MockDictationProvider({
      transcript: 'Write something',
    });
    const processTranscript = vi.spyOn(provider, 'processTranscript');

    await new DictationPipeline(provider, provider).process(audio, {
      ...options,
      profile: { displayName: 'Private Name', signature: 'Private Signature' },
    });

    expect(processTranscript).toHaveBeenCalledOnce();
    expect(processTranscript.mock.calls[0]?.[0]).toBe('Write something');
    expect(processTranscript.mock.calls[0]?.[1]).not.toHaveProperty('profile');
  });

  it('rejects empty audio before calling a provider', async () => {
    const pipeline = new DictationPipeline(new MockDictationProvider());

    await expect(
      pipeline.process({ ...audio, bytes: new Uint8Array() }, options),
    ).rejects.toMatchObject({
      code: 'INVALID_OPTIONS',
    } satisfies Partial<ProviderContractError>);
  });

  it('returns the raw transcript when no text provider is selected', async () => {
    const speech = new MockDictationProvider({
      polishedText: 'This must not be used',
      transcript: '  raw speech result  ',
    });

    await expect(
      new DictationPipeline(speech).process(audio, options),
    ).resolves.toMatchObject({
      intent: 'transcription',
      outputText: 'raw speech result',
      rawTranscript: 'raw speech result',
    });
  });

  it('mixes independent speech and text providers', async () => {
    const speech = new MockDictationProvider({ transcript: 'raw transcript' });
    const text = new MockDictationProvider({
      polishedText: 'Polished by another provider',
    });

    await expect(
      new DictationPipeline(speech, text).process(audio, options),
    ).resolves.toMatchObject({
      outputText: 'Polished by another provider',
      rawTranscript: 'raw transcript',
    });
  });

  it('preserves the raw transcript when one-pass processing fails', async () => {
    const speech = new MockDictationProvider({ transcript: 'raw transcript' });
    const text = new MockDictationProvider();
    const failure = new Error('text processing unavailable');
    vi.spyOn(text, 'processTranscript').mockRejectedValueOnce(failure);

    await expectRecoverableRawTranscript(
      new DictationPipeline(speech, text).process(audio, options),
      failure,
    );
  });

  it('keeps speech and empty-transcript failures hard', async () => {
    const speechFailure = new Error('speech unavailable');
    const failedSpeech = new MockDictationProvider();
    vi.spyOn(failedSpeech, 'transcribe').mockRejectedValueOnce(speechFailure);

    await expect(
      new DictationPipeline(failedSpeech, new MockDictationProvider()).process(
        audio,
        options,
      ),
    ).rejects.toBe(speechFailure);

    await expect(
      new DictationPipeline(
        new MockDictationProvider({ transcript: '   ' }),
        new MockDictationProvider(),
      ).process(audio, options),
    ).rejects.toMatchObject({ code: 'EMPTY_RESULT' });
  });

  it('keeps an empty one-pass result hard', async () => {
    const speech = new MockDictationProvider({ transcript: 'raw transcript' });
    const text = new MockDictationProvider();
    vi.spyOn(text, 'processTranscript').mockResolvedValueOnce({
      intent: 'transcription',
      outputText: '   ',
    });

    await expect(
      new DictationPipeline(speech, text).process(audio, options),
    ).rejects.toMatchObject({ code: 'EMPTY_RESULT' });
  });

  it('keeps an abort during text processing hard', async () => {
    const controller = new AbortController();
    const speech = new MockDictationProvider({ transcript: 'raw transcript' });
    const text = new MockDictationProvider();
    vi.spyOn(text, 'processTranscript').mockImplementationOnce(() => {
      controller.abort();
      return Promise.reject(new Error('request aborted'));
    });

    await expect(
      new DictationPipeline(speech, text).process(audio, {
        ...options,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: 'ABORTED' });
  });

  it('stops before provider work when cancelled', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      new DictationPipeline(new MockDictationProvider()).process(audio, {
        ...options,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({
      code: 'ABORTED',
    } satisfies Partial<ProviderContractError>);
  });
});
