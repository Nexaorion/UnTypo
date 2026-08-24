import { describe, expect, it, vi } from 'vitest';
import type {
  GenerationContext,
  ProviderContractError,
  AudioPayload,
  ProcessOptions,
} from '../../src/core/providers/contracts';
import { MockDictationProvider } from '../../src/core/providers/mock-provider';
import { DictationPipeline } from '../../src/core/providers/pipeline';

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

describe('DictationPipeline', () => {
  it('prefers a spoken translation target over the configured default', async () => {
    const provider = new MockDictationProvider({
      intent: 'translation',
      transcript: 'hello',
      translatedText: { 'en-US': 'Hello', 'zh-CN': '你好' },
    });
    const translate = vi.spyOn(provider, 'translate');

    const result = await new DictationPipeline(provider, provider).process(
      audio,
      {
        ...options,
        explicitTargetLanguage: 'en-US',
      },
    );

    expect(result.outputText).toBe('Hello');
    expect(translate).toHaveBeenCalledWith(
      'hello',
      expect.objectContaining({ targetLanguage: 'en-US' }),
    );
  });

  it('uses the target language detected by the intent classifier', async () => {
    const provider = new MockDictationProvider({
      explicitTargetLanguage: 'en-US',
      intent: 'translation',
      transcript: '请翻译成英文：你好',
      translatedText: { 'en-US': 'Hello', 'zh-CN': '你好' },
    });

    const result = await new DictationPipeline(provider, provider).process(
      audio,
      options,
    );

    expect(result).toMatchObject({
      intent: 'translation',
      outputText: 'Hello',
    });
  });

  it('fixes providers without intent detection to transcription', async () => {
    const provider = new MockDictationProvider(
      {
        intent: 'instruction',
        polishedText: 'Polished transcript',
        transcript: 'raw transcript',
      },
      { intentDetection: false },
    );

    const result = await new DictationPipeline(provider, provider).process(
      audio,
      options,
    );

    expect(result).toMatchObject({
      intent: 'transcription',
      outputText: 'Polished transcript',
    });
  });

  it('does not send personal profile context to BYOK providers', async () => {
    const provider = new MockDictationProvider({
      generatedText: 'Generated',
      intent: 'instruction',
      transcript: 'Write something',
    });
    const generate = vi.spyOn(provider, 'generateFromInstruction');

    await new DictationPipeline(provider, provider).process(audio, {
      ...options,
      profile: { displayName: 'Private Name', signature: 'Private Signature' },
    });

    const calls = generate.mock.calls as unknown as Array<
      [string, GenerationContext]
    >;
    expect(calls[0]?.[1].profile).toBeUndefined();
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
