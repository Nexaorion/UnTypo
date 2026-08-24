import { describe, expect, it, vi } from 'vitest';
import type { AudioPayload } from '../../src/core/providers/contracts';
import { AliyunBailianSpeechProvider } from '../../src/core/providers/aliyun-bailian-speech-provider';

const audio: AudioPayload = {
  bytes: new Uint8Array([1, 2, 3]),
  channels: 1,
  durationMs: 1_000,
  mimeType: 'audio/webm;codecs=opus',
  sampleRateHz: 48_000,
};

const configuration = {
  apiKey: 'sk-bailian-test',
  baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
  displayName: 'Aliyun Bailian',
  id: 'aliyun-speech',
  model: 'qwen-audio-3.0-asr-flash',
};

describe('AliyunBailianSpeechProvider', () => {
  it('sends Base64 WebM audio and recognition parameters', async () => {
    const request = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ output: { sentence: { text: '百炼转写' } } }),
          { status: 200 },
        ),
      ),
    );
    const provider = new AliyunBailianSpeechProvider(configuration, request);

    await expect(
      provider.transcribe(audio, {
        dictionary: [' UnTypo ', 'UnTypo', '百炼'],
        language: 'zh-CN',
      }),
    ).resolves.toMatchObject({
      language: 'zh-CN',
      text: '百炼转写',
      usage: { audioDurationMs: 1_000 },
    });

    const [url, init] = request.mock.calls[0] ?? [];
    expect(url).toBe(
      'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
    );
    expect(init?.headers).toMatchObject({
      Authorization: 'Bearer sk-bailian-test',
      'Content-Type': 'application/json',
      'X-DashScope-SSE': 'disable',
    });
    if (typeof init?.body !== 'string') throw new Error('Expected JSON body');
    const body = JSON.parse(init.body) as {
      input: {
        messages: Array<{
          content: Array<{ input_audio: { data: string }; type: string }>;
        }>;
      };
      parameters: Record<string, unknown>;
    };
    expect(body.input.messages[0]?.content[0]).toMatchObject({
      input_audio: { data: 'data:audio/webm;base64,AQID' },
      type: 'input_audio',
    });
    expect(body.parameters).toEqual({
      format: 'webm',
      language_hints: ['zh'],
      sample_rate: '48000',
      vocabulary: { UnTypo: 5, 百炼: 5 },
    });
  });

  it.each([
    { output: { text: 'direct' } },
    { output: { sentence: { text: 'sentence' } } },
    { output: { output: { sentence: { text: 'nested' } } } },
  ])('accepts supported response shapes', async (payload) => {
    const provider = new AliyunBailianSpeechProvider(
      configuration,
      vi.fn(() =>
        Promise.resolve(new Response(JSON.stringify(payload), { status: 200 })),
      ),
    );

    await expect(
      provider.transcribe(audio, { dictionary: [], language: 'en-US' }),
    ).resolves.toMatchObject({
      text:
        payload.output.text ??
        payload.output.sentence?.text ??
        payload.output.output?.sentence?.text,
    });
  });

  it('rejects audio longer than five minutes before fetching', async () => {
    const request = vi.fn();
    const provider = new AliyunBailianSpeechProvider(configuration, request);

    await expect(
      provider.transcribe(
        { ...audio, durationMs: 300_001 },
        { dictionary: [], language: 'en-US' },
      ),
    ).rejects.toMatchObject({ code: 'INVALID_OPTIONS' });
    expect(request).not.toHaveBeenCalled();
  });

  it('omits empty instant vocabulary from the request', async () => {
    const request = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(JSON.stringify({ output: { text: 'ready' } }), {
          status: 200,
        }),
      ),
    );
    const provider = new AliyunBailianSpeechProvider(configuration, request);

    await provider.transcribe(audio, { dictionary: [], language: 'en-US' });

    const [, init] = request.mock.calls[0] ?? [];
    if (typeof init?.body !== 'string') throw new Error('Expected JSON body');
    const body = JSON.parse(init.body) as {
      parameters: Record<string, unknown>;
    };
    expect(body.parameters).not.toHaveProperty('vocabulary');
  });

  it('uses the official public audio sample for connection testing', async () => {
    const request = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(JSON.stringify({ output: { text: 'ready' } }), {
          status: 200,
        }),
      ),
    );
    const provider = new AliyunBailianSpeechProvider(configuration, request);

    await expect(provider.testConnection()).resolves.toBeUndefined();

    const [url, init] = request.mock.calls[0] ?? [];
    expect(url).toBe(
      'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
    );
    if (typeof init?.body !== 'string') throw new Error('Expected JSON body');
    expect(JSON.parse(init.body)).toMatchObject({
      input: {
        messages: [
          {
            content: [
              {
                input_audio: {
                  data: 'https://dashscope.oss-cn-beijing.aliyuncs.com/samples/audio/paraformer/hello_world_female2.wav',
                },
                type: 'input_audio',
              },
            ],
            role: 'user',
          },
        ],
      },
      model: 'qwen-audio-3.0-asr-flash',
      parameters: {
        format: 'wav',
        language_hints: ['en'],
        sample_rate: '16000',
      },
    });
  });

  it('rejects encoded audio larger than 10 MiB before fetching', async () => {
    const request = vi.fn();
    const provider = new AliyunBailianSpeechProvider(configuration, request);

    await expect(
      provider.transcribe(
        { ...audio, bytes: new Uint8Array(7_864_320) },
        { dictionary: [], language: 'en-US' },
      ),
    ).rejects.toMatchObject({ code: 'INVALID_OPTIONS' });
    expect(request).not.toHaveBeenCalled();
  });

  it('surfaces a provider error message', async () => {
    const provider = new AliyunBailianSpeechProvider(
      configuration,
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ message: 'InvalidApiKey' }), {
            status: 401,
          }),
        ),
      ),
    );

    await expect(
      provider.transcribe(audio, { dictionary: [], language: 'en-US' }),
    ).rejects.toThrow('InvalidApiKey');
  });

  it('preserves an error code and request ID from failed requests', async () => {
    const provider = new AliyunBailianSpeechProvider(
      configuration,
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              code: 'InvalidAudio',
              request_id: 'request-123',
            }),
            { status: 400 },
          ),
        ),
      ),
    );

    await expect(
      provider.transcribe(audio, { dictionary: [], language: 'en-US' }),
    ).rejects.toThrow(
      'Aliyun Bailian request failed with status 400: code InvalidAudio, request_id request-123',
    );
  });

  it('preserves a non-JSON error response for diagnostics', async () => {
    const provider = new AliyunBailianSpeechProvider(
      configuration,
      vi.fn(() =>
        Promise.resolve(
          new Response('The audio payload was rejected', { status: 400 }),
        ),
      ),
    );

    await expect(
      provider.transcribe(audio, { dictionary: [], language: 'en-US' }),
    ).rejects.toThrow(
      'Aliyun Bailian request failed with status 400: response The audio payload was rejected',
    );
  });

  it('rejects a 200 response that contains an Aliyun error code', async () => {
    const provider = new AliyunBailianSpeechProvider(
      configuration,
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({ code: 'InvalidApiKey', message: 'Key mismatch' }),
            { status: 200 },
          ),
        ),
      ),
    );

    await expect(
      provider.transcribe(audio, { dictionary: [], language: 'en-US' }),
    ).rejects.toThrow('Key mismatch');
  });
});
