import { randomUUID } from 'node:crypto';
import {
  PROVIDER_CONTRACT_VERSION,
  ProviderContractError,
  type AudioPayload,
  type ProviderCapabilities,
  type RealtimeTranscriptionSession,
  type SpeechRecognitionProvider,
  type TranscriptResult,
  type TranscribeOptions,
} from './contracts.js';
import { audioFormatFromMimeType, audioMediaType } from './audio-format.js';
import {
  providerConfigSchema,
  providerUrl,
  readProviderJson,
  resolveProviderConfiguration,
  type ProviderConnectionConfiguration,
} from './provider-http.js';

export type AliyunBailianSpeechProviderConfiguration =
  ProviderConnectionConfiguration & {
    realtimeSpeechEnabled?: boolean;
  };

export interface ProviderWebSocket {
  close: () => void;
  onClose: (listener: () => void) => void;
  onError: (listener: () => void) => void;
  onMessage: (listener: (data: unknown) => void) => void;
  onOpen: (listener: () => void) => void;
  send: (data: string | Uint8Array) => void;
}

export type ProviderWebSocketFactory = (
  url: string,
  headers: Readonly<Record<string, string>>,
) => ProviderWebSocket;

interface AliyunSpeechPayload {
  output?: {
    output?: {
      sentence?: { text?: string };
    };
    sentence?: { text?: string };
    text?: string;
  };
}

const defaultCapabilities: Readonly<ProviderCapabilities> = {
  speechToText: true,
  textPolish: false,
  toneAdaptation: false,
  translation: false,
  instructionGeneration: false,
  intentDetection: false,
  streamingPartial: false,
};

const maximumDurationMs = 300_000;
const maximumEncodedAudioBytes = 10 * 1024 * 1024;
const maximumPendingRealtimeAudioBytes = 2 * 1024 * 1024;
const realtimeSampleRateHz = 16_000;
const realtimeModel = 'qwen-audio-3.0-asr-flash-streaming';
const synchronousModel = 'qwen-audio-3.0-asr-flash';
const connectionTestAudioUrl =
  'https://dashscope.oss-cn-beijing.aliyuncs.com/samples/audio/paraformer/hello_world_female2.wav';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const extractTranscript = (payload: unknown): string => {
  const output = (payload as AliyunSpeechPayload).output;
  for (const value of [
    output?.text,
    output?.sentence?.text,
    output?.output?.sentence?.text,
  ]) {
    if (value?.trim()) return value;
  }
  throw new ProviderContractError(
    'EMPTY_RESULT',
    'Aliyun Bailian returned an empty transcript',
  );
};

const supportsInstantHotword = (term: string): boolean => {
  const containsNonAscii = [...term].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && codePoint > 0x7f;
  });
  if (containsNonAscii) return [...term].length <= 15;
  return term.split(/\s+/u).length <= 7;
};

const instantVocabulary = (
  dictionary: readonly string[],
): Readonly<Record<string, number>> => {
  const entries = new Map<string, number>();
  for (const source of dictionary) {
    const term = source.normalize('NFKC').trim().replace(/\s+/gu, ' ');
    if (!term || !supportsInstantHotword(term) || entries.has(term)) continue;
    entries.set(term, 4);
    if (entries.size >= 2_000) break;
  }
  return Object.fromEntries(entries);
};

const realtimeUrl = (baseUrl: string): string => {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  const basePath = url.pathname
    .replace(/\/api\/v1\/?$/u, '')
    .replace(/\/$/u, '');
  url.pathname = `${basePath}/api-ws/v1/inference`;
  url.search = '';
  url.hash = '';
  return url.toString();
};

const realtimeMessageSource = (data: unknown): string | undefined => {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(
      new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    );
  }
  return undefined;
};

const parseRealtimeMessage = (data: unknown): Record<string, unknown> => {
  const source = realtimeMessageSource(data);
  if (!source) {
    throw new ProviderContractError(
      'INVALID_PROVIDER',
      'Aliyun Bailian returned an invalid realtime event',
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(source) as unknown;
  } catch {
    throw new ProviderContractError(
      'INVALID_PROVIDER',
      'Aliyun Bailian returned invalid realtime JSON',
    );
  }
  if (!isRecord(value)) {
    throw new ProviderContractError(
      'INVALID_PROVIDER',
      'Aliyun Bailian returned an invalid realtime event',
    );
  }
  return value;
};

class AliyunRealtimeTranscriptionSession implements RealtimeTranscriptionSession {
  readonly #socket: ProviderWebSocket;
  readonly #taskId = randomUUID();
  readonly #allowEmptyResult: boolean;
  readonly #language: TranscribeOptions['language'];
  readonly #signal?: AbortSignal;
  readonly #sentences = new Map<number, string>();
  readonly #pendingAudio: Uint8Array[] = [];
  #audioDurationMs = 0;
  #failure?: Error;
  #finishPromise?: Promise<TranscriptResult>;
  #finishReject?: (reason: Error) => void;
  #finishRequested = false;
  #finishResolve?: (result: TranscriptResult) => void;
  #finishTimer?: NodeJS.Timeout;
  #finished = false;
  #pendingAudioBytes = 0;
  #sentFinish = false;
  #started = false;
  #startTimer?: NodeJS.Timeout;
  #usageAudioDurationMs?: number;

  constructor({
    apiKey,
    allowEmptyResult = false,
    dictionary,
    factory,
    language,
    model,
    signal,
    url,
  }: {
    apiKey: string;
    allowEmptyResult?: boolean;
    dictionary: readonly string[];
    factory: ProviderWebSocketFactory;
    language: TranscribeOptions['language'];
    model: string;
    signal?: AbortSignal;
    url: string;
  }) {
    this.#signal = signal;
    this.#language = language;
    this.#allowEmptyResult = allowEmptyResult;
    this.#socket = factory(url, { Authorization: `Bearer ${apiKey}` });
    this.#socket.onOpen(() => {
      const vocabulary = instantVocabulary(dictionary);
      this.send(
        JSON.stringify({
          header: {
            action: 'run-task',
            streaming: 'duplex',
            task_id: this.#taskId,
          },
          payload: {
            function: 'recognition',
            input: {},
            model,
            parameters: {
              format: 'pcm',
              language_hints: [language === 'zh-CN' ? 'zh' : 'en'],
              sample_rate: realtimeSampleRateHz,
              ...(Object.keys(vocabulary).length > 0 ? { vocabulary } : {}),
            },
            task: 'asr',
            task_group: 'audio',
          },
        }),
      );
    });
    this.#socket.onMessage((data) => this.handleMessage(data));
    this.#socket.onError(() => {
      this.fail(new Error('Aliyun Bailian realtime connection failed'));
    });
    this.#socket.onClose(() => {
      if (!this.#finished && !this.#failure) {
        this.fail(
          new Error('Aliyun Bailian realtime connection closed unexpectedly'),
        );
      }
    });
    this.#startTimer = setTimeout(() => {
      this.fail(new Error('Aliyun Bailian realtime connection timed out'));
    }, 10_000);
    if (signal?.aborted) this.handleAbort();
    else signal?.addEventListener('abort', this.handleAbort, { once: true });
  }

  abort(): void {
    this.fail(
      new ProviderContractError('ABORTED', 'Realtime transcription aborted'),
    );
  }

  appendAudio(chunk: Uint8Array): void {
    if (
      chunk.byteLength === 0 ||
      this.#failure ||
      this.#finished ||
      this.#finishRequested
    ) {
      return;
    }
    const copy = Uint8Array.from(chunk);
    if (this.#started) {
      this.send(copy);
      return;
    }
    if (
      this.#pendingAudioBytes + copy.byteLength >
      maximumPendingRealtimeAudioBytes
    ) {
      this.fail(
        new Error('Aliyun Bailian realtime connection started too slowly'),
      );
      return;
    }
    this.#pendingAudio.push(copy);
    this.#pendingAudioBytes += copy.byteLength;
  }

  finish(audioDurationMs: number): Promise<TranscriptResult> {
    if (this.#finishPromise) return this.#finishPromise;
    this.#audioDurationMs = Math.max(0, Math.round(audioDurationMs));
    this.#finishRequested = true;
    this.#finishPromise = new Promise<TranscriptResult>((resolve, reject) => {
      this.#finishResolve = resolve;
      this.#finishReject = reject;
      if (this.#failure || this.#finished) {
        this.settleFinish();
        return;
      }
      this.#finishTimer = setTimeout(() => {
        this.fail(new Error('Aliyun Bailian realtime result timed out'));
      }, 20_000);
      if (this.#started) this.sendFinish();
    });
    return this.#finishPromise;
  }

  private readonly handleAbort = (): void => {
    this.abort();
  };

  private handleMessage(data: unknown): void {
    if (this.#failure || this.#finished) return;
    let message: Record<string, unknown>;
    try {
      message = parseRealtimeMessage(data);
    } catch (error) {
      this.fail(
        error instanceof Error
          ? error
          : new Error('Aliyun Bailian realtime event failed'),
      );
      return;
    }
    const header = isRecord(message.header) ? message.header : undefined;
    const taskId = header?.task_id;
    if (typeof taskId === 'string' && taskId !== this.#taskId) return;
    const event = header?.event;
    if (event === 'task-started') {
      this.#started = true;
      if (this.#startTimer) clearTimeout(this.#startTimer);
      this.#startTimer = undefined;
      for (const chunk of this.#pendingAudio) this.send(chunk);
      this.#pendingAudio.length = 0;
      this.#pendingAudioBytes = 0;
      if (this.#finishRequested) this.sendFinish();
      return;
    }
    if (event === 'result-generated') {
      this.captureResult(message);
      return;
    }
    if (event === 'task-failed') {
      const code =
        typeof header?.error_code === 'string' ? header.error_code : undefined;
      const detail =
        typeof header?.error_message === 'string'
          ? header.error_message.replace(/\s+/gu, ' ').trim().slice(0, 500)
          : undefined;
      this.fail(
        new Error(
          `Aliyun Bailian realtime task failed${code ? `: ${code}` : ''}${
            detail ? `, ${detail}` : ''
          }`,
        ),
      );
      return;
    }
    if (event === 'task-finished') {
      this.#finished = true;
      if (!this.#allowEmptyResult && !this.transcript()) {
        this.#failure = new ProviderContractError(
          'EMPTY_RESULT',
          'Aliyun Bailian returned an empty realtime transcript',
        );
      }
      this.cleanup();
      this.closeSocket();
      this.settleFinish();
    }
  }

  private captureResult(message: Record<string, unknown>): void {
    const payload = isRecord(message.payload) ? message.payload : undefined;
    const output = isRecord(payload?.output) ? payload.output : undefined;
    const sentence = isRecord(output?.sentence) ? output.sentence : undefined;
    if (sentence?.heartbeat === true) return;
    const sentenceId = sentence?.sentence_id;
    const text = sentence?.text;
    if (
      typeof sentenceId === 'number' &&
      Number.isInteger(sentenceId) &&
      sentenceId > 0 &&
      typeof text === 'string' &&
      text.trim()
    ) {
      this.#sentences.set(sentenceId, text.trim());
    }
    const usage = isRecord(payload?.usage) ? payload.usage : undefined;
    if (
      typeof usage?.duration === 'number' &&
      Number.isFinite(usage.duration) &&
      usage.duration >= 0
    ) {
      this.#usageAudioDurationMs = Math.round(usage.duration * 1_000);
    }
  }

  private transcript(): string {
    return [...this.#sentences.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, text]) => text)
      .join(this.#language === 'en-US' ? ' ' : '')
      .trim();
  }

  private sendFinish(): void {
    if (this.#sentFinish || this.#failure || this.#finished) return;
    this.#sentFinish = true;
    this.send(
      JSON.stringify({
        header: {
          action: 'finish-task',
          streaming: 'duplex',
          task_id: this.#taskId,
        },
        payload: { input: {} },
      }),
    );
  }

  private send(data: string | Uint8Array): void {
    if (this.#failure || this.#finished) return;
    try {
      this.#socket.send(data);
    } catch (error) {
      this.fail(
        error instanceof Error
          ? error
          : new Error('Aliyun Bailian realtime send failed'),
      );
    }
  }

  private settleFinish(): void {
    if (!this.#finishResolve || !this.#finishReject) return;
    const resolve = this.#finishResolve;
    const reject = this.#finishReject;
    this.#finishResolve = undefined;
    this.#finishReject = undefined;
    if (this.#failure) {
      reject(this.#failure);
      return;
    }
    const text = this.transcript();
    if (!text && !this.#allowEmptyResult) {
      reject(
        new ProviderContractError(
          'EMPTY_RESULT',
          'Aliyun Bailian returned an empty realtime transcript',
        ),
      );
      return;
    }
    resolve({
      language: this.#language,
      text,
      usage: {
        audioDurationMs: this.#usageAudioDurationMs ?? this.#audioDurationMs,
      },
    });
  }

  private fail(error: Error): void {
    if (this.#failure || this.#finished) return;
    this.#failure = error;
    this.#pendingAudio.length = 0;
    this.#pendingAudioBytes = 0;
    this.cleanup();
    this.closeSocket();
    this.settleFinish();
  }

  private cleanup(): void {
    if (this.#startTimer) clearTimeout(this.#startTimer);
    if (this.#finishTimer) clearTimeout(this.#finishTimer);
    this.#startTimer = undefined;
    this.#finishTimer = undefined;
    this.#signal?.removeEventListener('abort', this.handleAbort);
  }

  private closeSocket(): void {
    try {
      this.#socket.close();
    } catch {
      // The task outcome is already known when socket cleanup fails.
    }
  }
}

export class AliyunBailianSpeechProvider implements SpeechRecognitionProvider {
  readonly capabilities: Readonly<ProviderCapabilities>;
  readonly configSchema = providerConfigSchema;
  readonly contractVersion = PROVIDER_CONTRACT_VERSION;
  readonly displayName: string;
  readonly id: string;
  readonly kind = 'builtin' as const;
  readonly preferredAudioFormat = 'wav' as const;
  readonly realtimeAudioConfiguration?: {
    channels: 1;
    mimeType: 'audio/pcm';
    sampleRateHz: number;
  };
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;
  readonly #httpModel: string;
  readonly #model: string;
  readonly #realtimeSpeechEnabled: boolean;
  readonly #webSocketFactory?: ProviderWebSocketFactory;

  constructor(
    configuration: AliyunBailianSpeechProviderConfiguration,
    fetchImplementation: typeof fetch = fetch,
    webSocketFactory?: ProviderWebSocketFactory,
  ) {
    const resolved = resolveProviderConfiguration(configuration, {
      baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
      model: synchronousModel,
    });
    this.#realtimeSpeechEnabled = configuration.realtimeSpeechEnabled === true;
    if (this.#realtimeSpeechEnabled && resolved.model !== realtimeModel) {
      throw new ProviderContractError(
        'INVALID_OPTIONS',
        `Aliyun Bailian realtime speech requires model ${realtimeModel}`,
      );
    }
    this.id = resolved.id;
    this.displayName = resolved.displayName;
    this.#apiKey = resolved.apiKey;
    this.#baseUrl = resolved.baseUrl;
    this.#model = resolved.model;
    this.#httpModel = this.#realtimeSpeechEnabled
      ? synchronousModel
      : resolved.model;
    this.#fetch = fetchImplementation;
    this.#webSocketFactory = webSocketFactory;
    this.capabilities = {
      ...defaultCapabilities,
      streamingPartial: this.#realtimeSpeechEnabled,
    };
    if (this.#realtimeSpeechEnabled) {
      this.realtimeAudioConfiguration = {
        channels: 1,
        mimeType: 'audio/pcm',
        sampleRateHz: realtimeSampleRateHz,
      };
    }
  }

  createRealtimeTranscriptionSession(
    options: TranscribeOptions,
  ): RealtimeTranscriptionSession {
    if (!this.#realtimeSpeechEnabled || !this.#webSocketFactory) {
      throw new ProviderContractError(
        'UNSUPPORTED_CAPABILITY',
        'Aliyun Bailian realtime speech is unavailable',
      );
    }
    return new AliyunRealtimeTranscriptionSession({
      apiKey: this.#apiKey,
      dictionary: options.dictionary,
      factory: this.#webSocketFactory,
      language: options.language,
      model: this.#model,
      ...(options.signal ? { signal: options.signal } : {}),
      url: realtimeUrl(this.#baseUrl),
    });
  }

  async transcribe(
    audio: AudioPayload,
    options: TranscribeOptions,
  ): Promise<TranscriptResult> {
    if (audio.durationMs > maximumDurationMs) {
      throw new ProviderContractError(
        'INVALID_OPTIONS',
        'Aliyun Bailian audio cannot exceed 5 minutes',
      );
    }

    const dataUri = `data:${audioMediaType(audio.mimeType)};base64,${Buffer.from(
      audio.bytes,
    ).toString('base64')}`;
    if (Buffer.byteLength(dataUri, 'utf8') > maximumEncodedAudioBytes) {
      throw new ProviderContractError(
        'INVALID_OPTIONS',
        'Aliyun Bailian encoded audio cannot exceed 10 MiB',
      );
    }

    const vocabulary = instantVocabulary(options.dictionary);
    const response = await this.#fetch(
      providerUrl(
        this.#baseUrl,
        '/services/aigc/multimodal-generation/generation',
      ),
      {
        body: JSON.stringify({
          input: {
            messages: [
              {
                content: [
                  {
                    input_audio: { data: dataUri },
                    type: 'input_audio',
                  },
                ],
                role: 'user',
              },
            ],
          },
          model: this.#httpModel,
          parameters: {
            format: audioFormatFromMimeType(audio.mimeType),
            language_hints: [options.language === 'zh-CN' ? 'zh' : 'en'],
            sample_rate: String(audio.sampleRateHz),
            ...(Object.keys(vocabulary).length > 0 ? { vocabulary } : {}),
          },
        }),
        headers: {
          Authorization: `Bearer ${this.#apiKey}`,
          'Content-Type': 'application/json',
          'X-DashScope-SSE': 'disable',
        },
        method: 'POST',
        signal: options.signal,
      },
    );
    const payload = await readProviderJson(response, 'Aliyun Bailian');
    return {
      language: options.language,
      text: extractTranscript(payload),
      usage: { audioDurationMs: audio.durationMs },
    };
  }

  async testConnection(): Promise<void> {
    if (this.#realtimeSpeechEnabled) {
      if (!this.#webSocketFactory) {
        throw new ProviderContractError(
          'UNSUPPORTED_CAPABILITY',
          'Aliyun Bailian realtime speech is unavailable',
        );
      }
      const session = new AliyunRealtimeTranscriptionSession({
        allowEmptyResult: true,
        apiKey: this.#apiKey,
        dictionary: [],
        factory: this.#webSocketFactory,
        language: 'en-US',
        model: this.#model,
        url: realtimeUrl(this.#baseUrl),
      });
      session.appendAudio(new Uint8Array(3_200));
      await session.finish(100);
      return;
    }
    const response = await this.#fetch(
      providerUrl(
        this.#baseUrl,
        '/services/aigc/multimodal-generation/generation',
      ),
      {
        body: JSON.stringify({
          input: {
            messages: [
              {
                content: [
                  {
                    input_audio: { data: connectionTestAudioUrl },
                    type: 'input_audio',
                  },
                ],
                role: 'user',
              },
            ],
          },
          model: this.#httpModel,
          parameters: {
            format: 'wav',
            language_hints: ['en'],
            sample_rate: '16000',
          },
        }),
        headers: {
          Authorization: `Bearer ${this.#apiKey}`,
          'Content-Type': 'application/json',
          'X-DashScope-SSE': 'disable',
        },
        method: 'POST',
      },
    );
    extractTranscript(await readProviderJson(response, 'Aliyun Bailian'));
  }
}
