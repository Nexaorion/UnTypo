import { describe, expect, it, vi } from 'vitest';
import type { AudioPayload } from '../../src/core/providers/contracts';
import { OpenAIProvider } from '../../src/core/providers/openai-provider';

const audio: AudioPayload = {
  bytes: new Uint8Array([1, 2, 3]),
  channels: 1,
  durationMs: 1_000,
  mimeType: 'audio/webm;codecs=opus',
  sampleRateHz: 48_000,
};

const configuration = {
  apiKey: 'sk-test-secret',
  textModel: 'test-text-model',
  transcriptionModel: 'test-transcription-model',
};

describe('OpenAIProvider', () => {
  it('uploads in-memory audio with format metadata and no SDK dependency', async () => {
    const request = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            text: 'UnTypo transcript',
            usage: { input_tokens: 10, output_tokens: 3 },
          }),
          { status: 200 },
        ),
      );
    });
    const provider = new OpenAIProvider(configuration, request);

    const result = await provider.transcribe(audio, {
      dictionary: ['UnTypo'],
      language: 'en-US',
    });

    expect(result).toMatchObject({
      text: 'UnTypo transcript',
      usage: { audioDurationMs: 1_000, inputTokens: 10, outputTokens: 3 },
    });
    const [url, init] = request.mock.calls[0] ?? [];
    expect(url).toBe('https://api.openai.com/v1/audio/transcriptions');
    expect(init?.headers).toMatchObject({
      Authorization: 'Bearer sk-test-secret',
    });
    expect(init?.body).toBeInstanceOf(FormData);
    const form = init?.body as FormData;
    expect(form.get('model')).toBe('test-transcription-model');
    expect(form.get('language')).toBe('en');
    expect(form.get('prompt')).toContain('UnTypo');
    expect((form.get('file') as File).name).toBe('recording.webm');
  });

  it('uses one Responses structured output for intent and final text', async () => {
    const request = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            output: [
              {
                content: [
                  {
                    text: JSON.stringify({
                      intent: 'translation',
                      outputText: 'Hello',
                    }),
                    type: 'output_text',
                  },
                ],
              },
            ],
          }),
          { status: 200 },
        ),
      );
    });
    const provider = new OpenAIProvider(configuration, request);

    await expect(
      provider.processTranscript('Translate this into English: 你好', {
        defaultTargetLanguage: 'zh-CN',
        dictionary: [],
        locale: 'en-US',
      }),
    ).resolves.toEqual({
      intent: 'translation',
      outputText: 'Hello',
    });
    const [, init] = request.mock.calls[0] ?? [];
    if (typeof init?.body !== 'string') throw new Error('Expected JSON body');
    const body = JSON.parse(init.body) as {
      store: boolean;
      text: { format: { strict: boolean; type: string } };
    };
    expect(body.store).toBe(false);
    expect(body.text.format).toMatchObject({
      strict: true,
      type: 'json_schema',
    });
  });

  it('blocks plaintext public endpoints', () => {
    expect(
      () =>
        new OpenAIProvider({
          ...configuration,
          allowInsecurePrivateEndpoint: true,
          baseUrl: 'http://example.com/v1',
        }),
    ).toThrow('must use HTTPS');
  });

  it('allows explicitly enabled private development endpoints', () => {
    expect(
      () =>
        new OpenAIProvider({
          ...configuration,
          allowInsecurePrivateEndpoint: true,
          baseUrl: 'http://127.0.0.1:11434/v1',
        }),
    ).not.toThrow();
  });
});
