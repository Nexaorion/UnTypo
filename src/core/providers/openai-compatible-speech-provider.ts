import {
  PROVIDER_CONTRACT_VERSION,
  ProviderContractError,
  type AudioPayload,
  type ProviderCapabilities,
  type SpeechRecognitionProvider,
  type TranscriptResult,
  type TranscribeOptions,
} from './contracts.js';
import { audioFileExtension } from './audio-format.js';
import {
  providerConfigSchema,
  providerUrl,
  readProviderJson,
  resolveProviderConfiguration,
  type ProviderConnectionConfiguration,
} from './provider-http.js';

export type OpenAICompatibleSpeechProviderConfiguration =
  ProviderConnectionConfiguration;

interface OpenAITranscriptionPayload {
  text?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
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

const maximumUploadBytes = 25 * 1024 * 1024;
const maximumPromptUtf8Bytes = 200;
const promptPrefix = 'Preserve these terms exactly: ';

const dictionaryPrompt = (
  dictionary: readonly string[],
): string | undefined => {
  const encoder = new TextEncoder();
  let prompt = promptPrefix;
  for (const term of new Set(dictionary.map((entry) => entry.trim()))) {
    if (!term) continue;
    const candidate = `${prompt}${prompt === promptPrefix ? '' : ', '}${term}`;
    if (encoder.encode(candidate).byteLength <= maximumPromptUtf8Bytes) {
      prompt = candidate;
    }
  }
  return prompt === promptPrefix ? undefined : prompt;
};

export class OpenAICompatibleSpeechProvider implements SpeechRecognitionProvider {
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
    configuration: OpenAICompatibleSpeechProviderConfiguration,
    fetchImplementation: typeof fetch = fetch,
  ) {
    const resolved = resolveProviderConfiguration(configuration, {
      baseUrl: 'https://api.openai.com/v1',
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
    if (audio.bytes.byteLength > maximumUploadBytes) {
      throw new ProviderContractError(
        'INVALID_OPTIONS',
        'OpenAI-compatible transcription uploads cannot exceed 25 MiB',
      );
    }
    const form = new FormData();
    form.append(
      'file',
      new Blob([Uint8Array.from(audio.bytes).buffer], { type: audio.mimeType }),
      `recording.${audioFileExtension(audio.mimeType)}`,
    );
    form.append('model', this.#model);
    form.append('language', options.language === 'zh-CN' ? 'zh' : 'en');
    const prompt = dictionaryPrompt(options.dictionary);
    if (prompt) form.append('prompt', prompt);

    const response = await this.#fetch(
      providerUrl(this.#baseUrl, '/audio/transcriptions'),
      {
        body: form,
        headers: { Authorization: `Bearer ${this.#apiKey}` },
        method: 'POST',
        signal: options.signal,
      },
    );
    const payload = (await readProviderJson(
      response,
      'OpenAI-compatible speech provider',
    )) as OpenAITranscriptionPayload;
    if (!payload.text?.trim()) {
      throw new ProviderContractError(
        'EMPTY_RESULT',
        'OpenAI-compatible speech provider returned an empty transcript',
      );
    }
    return {
      language: options.language,
      text: payload.text,
      usage: {
        audioDurationMs: audio.durationMs,
        inputTokens: payload.usage?.input_tokens,
        outputTokens: payload.usage?.output_tokens,
      },
    };
  }
}
