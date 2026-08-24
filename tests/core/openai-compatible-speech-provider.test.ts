import { describe, expect, it, vi } from 'vitest';
import type { AudioPayload } from '../../src/core/providers/contracts';
import { OpenAICompatibleSpeechProvider } from '../../src/core/providers/openai-compatible-speech-provider';

const audio: AudioPayload = {
  bytes: new Uint8Array([1, 2, 3]),
  channels: 1,
  durationMs: 1_000,
  mimeType: 'audio/webm;codecs=opus',
  sampleRateHz: 48_000,
};

const configuration = {
  apiKey: 'sk-speech-test',
  baseUrl: 'https://speech.example.com/v1',
  displayName: 'Compatible Speech',
  id: 'compatible-speech',
  model: 'transcribe-test',
};

describe('OpenAICompatibleSpeechProvider', () => {
  it('uploads multipart audio to the transcription endpoint', async () => {
    const request = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            text: 'UnTypo transcript',
            usage: { input_tokens: 10, output_tokens: 3 },
          }),
          { status: 200 },
        ),
      ),
    );
    const provider = new OpenAICompatibleSpeechProvider(configuration, request);

    await expect(
      provider.transcribe(audio, {
        dictionary: ['UnTypo'],
        language: 'en-US',
      }),
    ).resolves.toMatchObject({
      text: 'UnTypo transcript',
      usage: { audioDurationMs: 1_000, inputTokens: 10, outputTokens: 3 },
    });

    const [url, init] = request.mock.calls[0] ?? [];
    expect(url).toBe('https://speech.example.com/v1/audio/transcriptions');
    expect(init?.headers).toMatchObject({
      Authorization: 'Bearer sk-speech-test',
    });
    expect(init?.body).toBeInstanceOf(FormData);
    const form = init?.body as FormData;
    expect(form.get('model')).toBe('transcribe-test');
    expect(form.get('language')).toBe('en');
    expect(form.get('prompt')).toContain('UnTypo');
    expect((form.get('file') as File).name).toBe('recording.webm');
  });

  it('surfaces a provider error message', async () => {
    const provider = new OpenAICompatibleSpeechProvider(
      configuration,
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({ error: { message: 'Audio rejected' } }),
            {
              status: 400,
            },
          ),
        ),
      ),
    );

    await expect(
      provider.transcribe(audio, { dictionary: [], language: 'en-US' }),
    ).rejects.toThrow('Audio rejected');
  });

  it('does not treat a successful HTTP error envelope as an empty transcript', async () => {
    const provider = new OpenAICompatibleSpeechProvider(
      configuration,
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              error: { message: 'Gateway authentication failed' },
            }),
            { status: 200 },
          ),
        ),
      ),
    );

    await expect(
      provider.transcribe(audio, { dictionary: [], language: 'en-US' }),
    ).rejects.toThrow('Gateway authentication failed');
  });

  it('bounds the dictionary prompt for Groq-compatible endpoints', async () => {
    const request = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(JSON.stringify({ text: 'bounded' }), { status: 200 }),
      ),
    );
    const provider = new OpenAICompatibleSpeechProvider(configuration, request);

    await provider.transcribe(audio, {
      dictionary: Array.from(
        { length: 1_000 },
        (_, index) => `超长术语-${String(index)}`,
      ),
      language: 'zh-CN',
    });

    const [, init] = request.mock.calls[0] ?? [];
    const prompt = (init?.body as FormData).get('prompt');
    expect(typeof prompt).toBe('string');
    if (typeof prompt !== 'string') {
      throw new TypeError('Expected a string prompt');
    }
    expect(new TextEncoder().encode(prompt).byteLength).toBeLessThanOrEqual(
      200,
    );
  });

  it('rejects uploads larger than the shared 25 MiB limit before fetching', async () => {
    const request = vi.fn<typeof fetch>();
    const provider = new OpenAICompatibleSpeechProvider(configuration, request);

    await expect(
      provider.transcribe(
        { ...audio, bytes: new Uint8Array(25 * 1024 * 1024 + 1) },
        { dictionary: [], language: 'en-US' },
      ),
    ).rejects.toMatchObject({ code: 'INVALID_OPTIONS' });
    expect(request).not.toHaveBeenCalled();
  });

  it('copies only the addressed bytes from Buffer subarrays', async () => {
    const backing = Buffer.from([99, 1, 2, 3, 88]);
    const request = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(JSON.stringify({ text: 'copied' }), { status: 200 }),
      ),
    );
    const provider = new OpenAICompatibleSpeechProvider(configuration, request);

    await provider.transcribe(
      { ...audio, bytes: backing.subarray(1, 4) },
      { dictionary: [], language: 'en-US' },
    );

    const [, init] = request.mock.calls[0] ?? [];
    const form = init?.body as FormData;
    const file = form.get('file') as File;
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3]),
    );
  });
});
