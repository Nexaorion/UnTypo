import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudioPayload } from '../../src/core/providers/types';
import {
  DEEPSEEK_ASR_BASE_URL,
  DEEPSEEK_ASR_MODEL,
  DEEPSEEK_ASR_REQUEST_TIMEOUT_MS,
  DeepSeekAsrSpeechProvider,
} from '../../src/core/providers/deepseek-asr-speech-provider';

const writeAscii = (view: DataView, offset: number, value: string): void => {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
};

const pcmWav = ({
  audioFormat = 1,
  bitsPerSample = 16,
  channels = 1,
  dataBytes,
  sampleRateHz = 16_000,
}: {
  audioFormat?: number;
  bitsPerSample?: number;
  channels?: number;
  dataBytes?: number;
  sampleRateHz?: number;
} = {}): Uint8Array => {
  const bytesPerSample = Math.max(1, Math.ceil(bitsPerSample / 8));
  const payloadBytes = dataBytes ?? channels * bytesPerSample * 8;
  const buffer = new ArrayBuffer(44 + payloadBytes);
  const view = new DataView(buffer);
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + payloadBytes, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, audioFormat, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRateHz, true);
  view.setUint32(28, sampleRateHz * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, payloadBytes, true);
  return new Uint8Array(buffer);
};

const wavWithLeadingJunk = (): Uint8Array => {
  const junkSize = 3;
  const fmtSize = 16;
  const dataBytes = 4;
  const buffer = new ArrayBuffer(12 + 8 + junkSize + 1 + 8 + fmtSize + 8 + dataBytes);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, buffer.byteLength - 8, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'JUNK');
  view.setUint32(16, junkSize, true);
  bytes[23] = 0;
  const fmtOffset = 24;
  writeAscii(view, fmtOffset, 'fmt ');
  view.setUint32(fmtOffset + 4, fmtSize, true);
  view.setUint16(fmtOffset + 8, 1, true);
  view.setUint16(fmtOffset + 10, 1, true);
  view.setUint32(fmtOffset + 12, 16_000, true);
  view.setUint32(fmtOffset + 16, 32_000, true);
  view.setUint16(fmtOffset + 20, 2, true);
  view.setUint16(fmtOffset + 22, 16, true);
  const dataOffset = fmtOffset + 8 + fmtSize;
  writeAscii(view, dataOffset, 'data');
  view.setUint32(dataOffset + 4, dataBytes, true);
  return bytes;
};

const oggOpus = (marker = true): Uint8Array =>
  new TextEncoder().encode(`OggS${' '.repeat(24)}${marker ? 'OpusHead' : 'Vorbis'}tail`);

const audioFrom = (bytes: Uint8Array, overrides: Partial<AudioPayload> = {}): AudioPayload => ({
  bytes,
  channels: 1,
  durationMs: 1_000,
  mimeType: 'audio/wav',
  sampleRateHz: 16_000,
  ...overrides,
});

const configuration = {
  apiKey: ' sk-deepseek ',
  baseUrl: 'https://asr.example.test/v1/',
  displayName: ' DeepSeek ASR ',
  id: 'deepseek-asr-speech',
  model: 'custom-label',
};

const successBody = {
  duration_ms: 3_200,
  request_id: 'req-1',
  text: '今天天气怎么样',
};

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status });

describe('DeepSeekAsrSpeechProvider', () => {
  beforeEach(() => {
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => new AbortController().signal);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uploads only the audio file and reads the transcript', async () => {
    const wav = pcmWav({ channels: 2, sampleRateHz: 48_000 });
    const request = vi.fn<typeof fetch>(() => Promise.resolve(jsonResponse(successBody)));
    const provider = new DeepSeekAsrSpeechProvider(configuration, request);

    await expect(
      provider.transcribe(audioFrom(wav, { channels: 2, sampleRateHz: 48_000 }), {
        dictionary: ['上海', 'UnTypo'],
        language: 'zh-CN',
      }),
    ).resolves.toEqual({
      language: 'zh-CN',
      text: '今天天气怎么样',
      usage: { audioDurationMs: 3_200 },
    });

    const [url, init] = request.mock.calls[0] ?? [];
    expect(url).toBe('https://asr.example.test/v1/tools/asr');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({ Authorization: 'Bearer sk-deepseek' });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(vi.spyOn(AbortSignal, 'timeout')).toHaveBeenCalledWith(DEEPSEEK_ASR_REQUEST_TIMEOUT_MS);
    expect(init?.body).toBeInstanceOf(FormData);
    const form = init?.body as FormData;
    expect([...form.keys()]).toEqual(['file']);
    expect(form.get('model')).toBeNull();
    expect(form.get('language')).toBeNull();
    expect(form.get('prompt')).toBeNull();
    const file = form.get('file');
    if (!(file instanceof File)) throw new TypeError('Expected an audio file');
    expect(file.name).toBe('speech.wav');
    expect(file.type).toBe('audio/wav');
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(wav);
    expect(provider.preferredAudioFormat).toBe('wav');
    expect(provider.capabilities).toMatchObject({
      speechToText: true,
      streamingPartial: false,
    });
    expect(provider.createRealtimeTranscriptionSession).toBeUndefined();
  });

  it('uses the official endpoint when the profile omits the URL and model', async () => {
    const request = vi.fn<typeof fetch>(() =>
      Promise.resolve(jsonResponse({ text: 'hello', duration_ms: 10 })),
    );
    const provider = new DeepSeekAsrSpeechProvider(
      {
        apiKey: 'sk-default',
        displayName: 'DeepSeek ASR',
        id: 'deepseek-asr',
        model: '   ',
      },
      request,
    );

    await provider.transcribe(audioFrom(pcmWav()), { dictionary: [], language: 'en-US' });

    expect(request.mock.calls[0]?.[0]).toBe(`${DEEPSEEK_ASR_BASE_URL}/tools/asr`);
    expect(DEEPSEEK_ASR_MODEL).toBe('deepseek-asr');
  });

  it('strips query parameters and fragments from the endpoint', async () => {
    const request = vi.fn<typeof fetch>(() => Promise.resolve(jsonResponse({ text: 'ok' })));
    const provider = new DeepSeekAsrSpeechProvider(
      {
        ...configuration,
        apiKey: 'sk-test',
        baseUrl: 'https://api.deepseek.com/v1/?token=secret#fragment',
      },
      request,
    );

    await provider.transcribe(audioFrom(pcmWav()), { dictionary: [], language: 'en-US' });

    expect(request.mock.calls[0]?.[0]).toBe('https://api.deepseek.com/v1/tools/asr');
  });

  it('forwards caller cancellation through the upload signal', async () => {
    const controller = new AbortController();
    let seen: AbortSignal | undefined;
    const request = vi.fn<typeof fetch>((_url, init) => {
      seen = init?.signal ?? undefined;
      controller.abort();
      return Promise.resolve(jsonResponse({ text: 'late' }));
    });
    const provider = new DeepSeekAsrSpeechProvider(configuration, request);

    await provider.transcribe(audioFrom(pcmWav()), {
      dictionary: [],
      language: 'en-US',
      signal: controller.signal,
    });

    expect(seen?.aborted).toBe(true);
  });

  it('copies only the addressed bytes from a subarray view', async () => {
    const wav = pcmWav();
    const padded = new Uint8Array(wav.byteLength + 2);
    padded[0] = 9;
    padded[padded.length - 1] = 7;
    padded.set(wav, 1);
    const request = vi.fn<typeof fetch>(() => Promise.resolve(jsonResponse({ text: 'copied' })));
    const provider = new DeepSeekAsrSpeechProvider(configuration, request);

    await provider.transcribe(audioFrom(padded.subarray(1, 1 + wav.byteLength)), {
      dictionary: [],
      language: 'en-US',
    });

    const form = request.mock.calls[0]?.[1]?.body as FormData;
    const file = form.get('file');
    if (!(file instanceof File)) throw new TypeError('Expected an audio file');
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(wav);
  });

  it('accepts a WAV file whose fmt chunk is not at a fixed offset', async () => {
    const wav = wavWithLeadingJunk();
    const request = vi.fn<typeof fetch>(() => Promise.resolve(jsonResponse({ text: 'junk-ok' })));
    const provider = new DeepSeekAsrSpeechProvider(configuration, request);

    await provider.transcribe(audioFrom(wav, { mimeType: 'application/octet-stream' }), {
      dictionary: [],
      language: 'en-US',
    });

    const form = request.mock.calls[0]?.[1]?.body as FormData;
    const file = form.get('file');
    if (!(file instanceof File)) throw new TypeError('Expected an audio file');
    expect(file.name).toBe('speech.wav');
    expect(file.type).toBe('audio/wav');
  });

  it('sends Ogg Opus when that is the file content', async () => {
    const bytes = oggOpus();
    const request = vi.fn<typeof fetch>(() => Promise.resolve(jsonResponse({ text: 'opus' })));
    const provider = new DeepSeekAsrSpeechProvider(configuration, request);

    await provider.transcribe(audioFrom(bytes, { mimeType: 'audio/wav' }), {
      dictionary: [],
      language: 'en-US',
    });

    const form = request.mock.calls[0]?.[1]?.body as FormData;
    const file = form.get('file');
    if (!(file instanceof File)) throw new TypeError('Expected an audio file');
    expect(file.name).toBe('speech.ogg');
    expect(file.type).toBe('audio/ogg');
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes);
  });

  it('falls back to the recorded duration when duration_ms is absent or unusable', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ request_id: 'req-2', text: 'no duration' }))
      .mockResolvedValueOnce(jsonResponse({ duration_ms: -5, text: 'negative' }))
      .mockResolvedValueOnce(jsonResponse({ duration_ms: '3200', text: 'string duration' }));
    const provider = new DeepSeekAsrSpeechProvider(configuration, request);
    const audio = audioFrom(pcmWav(), { durationMs: 1_500 });

    await expect(
      provider.transcribe(audio, { dictionary: [], language: 'en-US' }),
    ).resolves.toMatchObject({
      usage: { audioDurationMs: 1_500 },
    });
    await expect(
      provider.transcribe(audio, { dictionary: [], language: 'en-US' }),
    ).resolves.toMatchObject({
      usage: { audioDurationMs: 1_500 },
    });
    await expect(
      provider.transcribe(audio, { dictionary: [], language: 'en-US' }),
    ).resolves.toMatchObject({
      usage: { audioDurationMs: 1_500 },
    });
  });

  it('keeps a reported duration of zero', async () => {
    const provider = new DeepSeekAsrSpeechProvider(
      configuration,
      vi.fn<typeof fetch>(() => Promise.resolve(jsonResponse({ duration_ms: 0, text: 'silence' }))),
    );

    await expect(
      provider.transcribe(audioFrom(pcmWav()), { dictionary: [], language: 'en-US' }),
    ).resolves.toMatchObject({ text: 'silence', usage: { audioDurationMs: 0 } });
  });

  it('rejects an empty transcript', async () => {
    const provider = new DeepSeekAsrSpeechProvider(
      configuration,
      vi.fn<typeof fetch>(() =>
        Promise.resolve(jsonResponse({ duration_ms: 10, request_id: 'req-3', text: '   ' })),
      ),
    );

    await expect(
      provider.transcribe(audioFrom(pcmWav()), { dictionary: [], language: 'en-US' }),
    ).rejects.toMatchObject({
      code: 'EMPTY_RESULT',
      message: 'DeepSeek ASR returned an empty transcript',
    });
  });

  it('rejects a success payload that is not a transcript object', async () => {
    const provider = new DeepSeekAsrSpeechProvider(
      configuration,
      vi.fn<typeof fetch>(() => Promise.resolve(jsonResponse(['not-an-object']))),
    );

    await expect(
      provider.transcribe(audioFrom(pcmWav()), { dictionary: [], language: 'en-US' }),
    ).rejects.toMatchObject({ code: 'INVALID_PROVIDER' });
  });

  it('does not treat a successful error envelope as a transcript', async () => {
    const provider = new DeepSeekAsrSpeechProvider(
      configuration,
      vi.fn<typeof fetch>(() =>
        Promise.resolve(
          jsonResponse({
            error: { message: 'Gateway authentication failed' },
            text: 'ignored',
          }),
        ),
      ),
    );

    await expect(
      provider.transcribe(audioFrom(pcmWav()), { dictionary: [], language: 'en-US' }),
    ).rejects.toThrow('Gateway authentication failed');
  });

  it.each([
    [400, 'the audio is not 16-bit PCM WAV or Ogg Opus, or the file field is missing'],
    [408, 'the upload timed out after 10 minutes'],
    [413, 'the audio file is larger than 8 MiB'],
    [429, 'too many requests are already in progress (maximum 50)'],
    [503, 'the speech service is busy'],
    [504, 'recognition timed out'],
  ])('explains HTTP %s from the documented ASR errors', async (status, detail) => {
    const provider = new DeepSeekAsrSpeechProvider(
      configuration,
      vi.fn<typeof fetch>(() => Promise.resolve(new Response('', { status }))),
    );

    await expect(
      provider.transcribe(audioFrom(pcmWav()), { dictionary: [], language: 'en-US' }),
    ).rejects.toThrow(`DeepSeek ASR request failed with status ${String(status)} (${detail})`);
  });

  it('keeps the provider request id and message on a documented error', async () => {
    const provider = new DeepSeekAsrSpeechProvider(
      configuration,
      vi.fn<typeof fetch>(() =>
        Promise.resolve(
          jsonResponse({ error: { message: 'Audio rejected' }, request_id: 'req-9' }, 400),
        ),
      ),
    );

    await expect(
      provider.transcribe(audioFrom(pcmWav()), { dictionary: [], language: 'en-US' }),
    ).rejects.toThrow(
      'DeepSeek ASR request failed with status 400: Audio rejected, request_id req-9 (the audio is not 16-bit PCM WAV or Ogg Opus, or the file field is missing)',
    );
  });

  it('leaves undocumented statuses to the shared provider error', async () => {
    const provider = new DeepSeekAsrSpeechProvider(
      configuration,
      vi.fn<typeof fetch>(() =>
        Promise.resolve(jsonResponse({ error: { message: 'Invalid API key' } }, 401)),
      ),
    );

    await expect(
      provider.transcribe(audioFrom(pcmWav()), { dictionary: [], language: 'en-US' }),
    ).rejects.toThrow('DeepSeek ASR request failed with status 401: Invalid API key');
  });

  it('rejects audio that DeepSeek cannot recognize before uploading', async () => {
    const request = vi.fn<typeof fetch>();
    const provider = new DeepSeekAsrSpeechProvider(configuration, request);
    const cases: Array<[AudioPayload, string]> = [
      [audioFrom(pcmWav(), { durationMs: 120_001 }), 'cannot exceed 120 seconds'],
      [audioFrom(pcmWav(), { durationMs: Number.NaN }), 'duration is invalid'],
      [
        audioFrom(new Uint8Array(8 * 1024 * 1024 + 1), { durationMs: 1_000 }),
        'cannot exceed 8 MiB',
      ],
      [audioFrom(pcmWav({ bitsPerSample: 24 })), 'must be 16-bit PCM'],
      [audioFrom(pcmWav({ audioFormat: 3 })), 'must be 16-bit PCM'],
      [audioFrom(pcmWav({ channels: 3 })), 'mono or stereo'],
      [audioFrom(pcmWav({ sampleRateHz: 11_025 })), 'sample rate must be'],
      [audioFrom(oggOpus(false), { mimeType: 'audio/ogg' }), 'Ogg Opus'],
      [audioFrom(new Uint8Array([1, 2, 3, 4]), { mimeType: 'audio/webm' }), 'Ogg Opus'],
    ];

    for (const [audio, message] of cases) {
      await expect(
        provider.transcribe(audio, { dictionary: [], language: 'en-US' }),
      ).rejects.toMatchObject({
        code: 'INVALID_OPTIONS',
        message: expect.stringContaining(message) as string,
      });
    }
    expect(request).not.toHaveBeenCalled();
  });

  it('rejects WAV content longer than 120 seconds even when the metadata is shorter', async () => {
    const request = vi.fn<typeof fetch>();
    const provider = new DeepSeekAsrSpeechProvider(configuration, request);
    const dataBytes = (8_000 * 120 + 1) * 2;

    await expect(
      provider.transcribe(
        audioFrom(pcmWav({ dataBytes, sampleRateHz: 8_000 }), { durationMs: 1_000 }),
        { dictionary: [], language: 'en-US' },
      ),
    ).rejects.toMatchObject({ code: 'INVALID_OPTIONS' });
    expect(request).not.toHaveBeenCalled();
  });

  it('accepts WAV content of exactly 120 seconds', async () => {
    const request = vi.fn<typeof fetch>(() => Promise.resolve(jsonResponse({ text: 'boundary' })));
    const provider = new DeepSeekAsrSpeechProvider(configuration, request);

    await expect(
      provider.transcribe(
        audioFrom(pcmWav({ dataBytes: 8_000 * 2 * 120, sampleRateHz: 8_000 }), {
          durationMs: 120_000,
          sampleRateHz: 8_000,
        }),
        { dictionary: [], language: 'en-US' },
      ),
    ).resolves.toMatchObject({ text: 'boundary' });
    expect(request).toHaveBeenCalledOnce();
  });

  it('requires HTTPS unless a private endpoint is explicitly allowed', () => {
    expect(
      () =>
        new DeepSeekAsrSpeechProvider({
          ...configuration,
          apiKey: 'sk-test',
          baseUrl: 'http://example.com/v1',
        }),
    ).toThrow('HTTPS');
    expect(
      () =>
        new DeepSeekAsrSpeechProvider({
          ...configuration,
          allowInsecurePrivateEndpoint: true,
          apiKey: 'sk-test',
          baseUrl: 'http://127.0.0.1:9/v1',
        }),
    ).not.toThrow();
  });
});
