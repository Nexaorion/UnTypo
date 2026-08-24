import {
  PROVIDER_CONTRACT_VERSION,
  ProviderContractError,
  type AudioPayload,
  type ProviderCapabilities,
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
  ProviderConnectionConfiguration;

interface AliyunSpeechPayload {
  output?: {
    output?: {
      sentence?: { text?: string };
    };
    sentence?: { text?: string };
    text?: string;
  };
}

const capabilities: Readonly<ProviderCapabilities> = {
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

export class AliyunBailianSpeechProvider implements SpeechRecognitionProvider {
  readonly capabilities = capabilities;
  readonly configSchema = providerConfigSchema;
  readonly contractVersion = PROVIDER_CONTRACT_VERSION;
  readonly displayName: string;
  readonly id: string;
  readonly kind = 'builtin' as const;
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;
  readonly #model: string;

  constructor(
    configuration: AliyunBailianSpeechProviderConfiguration,
    fetchImplementation: typeof fetch = fetch,
  ) {
    const resolved = resolveProviderConfiguration(configuration, {
      baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
      model: 'qwen-audio-3.0-asr-flash',
    });
    this.id = resolved.id;
    this.displayName = resolved.displayName;
    this.#apiKey = resolved.apiKey;
    this.#baseUrl = resolved.baseUrl;
    this.#model = resolved.model;
    this.#fetch = fetchImplementation;
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

    const vocabulary = Object.fromEntries(
      [...new Set(options.dictionary.map((term) => term.trim()))]
        .filter(Boolean)
        .map((term) => [term, 5]),
    );
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
          model: this.#model,
          parameters: {
            format: audioFormatFromMimeType(audio.mimeType),
            language_hints: [options.language === 'zh-CN' ? 'zh' : 'en'],
            sample_rate: String(audio.sampleRateHz),
            vocabulary,
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
}
