import {
  PROVIDER_CONTRACT_VERSION,
  ProviderContractError,
  type AudioPayload,
  type DictationProvider,
  type GenerationContext,
  type IntentClassificationResult,
  type IntentContext,
  type PolishContext,
  type ProviderCapabilities,
  type TranscriptResult,
  type TranscribeOptions,
  type TranslationContext,
} from './contracts.js';

export interface OpenAIProviderConfiguration {
  allowInsecurePrivateEndpoint?: boolean;
  apiKey: string;
  baseUrl?: string;
  textModel: string;
  transcriptionModel: string;
}

interface OpenAIErrorResponse {
  error?: {
    message?: string;
  };
}

interface OpenAITranscriptionResponse {
  text?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

interface OpenAIResponsePayload {
  output?: Array<{
    content?: Array<{
      text?: string;
      type?: string;
    }>;
  }>;
  output_text?: string;
}

const capabilities: ProviderCapabilities = {
  speechToText: true,
  textPolish: true,
  toneAdaptation: true,
  translation: true,
  instructionGeneration: true,
  intentDetection: true,
  streamingPartial: false,
};

const privateHostPattern =
  /^(localhost|127(?:\.\d{1,3}){3}|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|\[?::1\]?|\[?f[cd][0-9a-f:]+\]?|[^.]+\.local)$/iu;

const validateBaseUrl = (
  value: string,
  allowInsecurePrivateEndpoint: boolean,
): string => {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' &&
    !(
      allowInsecurePrivateEndpoint &&
      url.protocol === 'http:' &&
      privateHostPattern.test(url.hostname)
    )
  ) {
    throw new ProviderContractError(
      'INVALID_OPTIONS',
      'Provider endpoints must use HTTPS unless explicit private-network access is enabled',
    );
  }
  url.pathname = url.pathname.replace(/\/+$/u, '');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/u, '');
};

const extensionForMimeType = (mimeType: string): string => {
  if (mimeType.includes('wav')) return 'wav';
  if (mimeType.includes('mpeg') || mimeType.includes('mp3')) return 'mp3';
  if (mimeType.includes('mp4') || mimeType.includes('m4a')) return 'm4a';
  if (mimeType.includes('ogg')) return 'ogg';
  return 'webm';
};

const extractOutputText = (payload: OpenAIResponsePayload): string => {
  if (payload.output_text?.trim()) return payload.output_text;
  for (const item of payload.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === 'output_text' && content.text?.trim()) {
        return content.text;
      }
    }
  }
  throw new ProviderContractError(
    'EMPTY_RESULT',
    'OpenAI returned an empty response',
  );
};

export class OpenAIProvider implements DictationProvider {
  readonly capabilities = capabilities;
  readonly configSchema = {
    additionalProperties: false,
    properties: {
      apiKey: { format: 'password', title: 'API Key', type: 'string' },
      baseUrl: { format: 'uri', title: 'Base URL', type: 'string' },
      textModel: { title: 'Text model', type: 'string' },
      transcriptionModel: {
        title: 'Transcription model',
        type: 'string',
      },
    },
    required: ['apiKey', 'textModel', 'transcriptionModel'],
    type: 'object',
  } as const;
  readonly contractVersion = PROVIDER_CONTRACT_VERSION;
  readonly displayName = 'OpenAI';
  readonly id = 'openai';
  readonly kind = 'builtin' as const;
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;
  readonly #textModel: string;
  readonly #transcriptionModel: string;

  constructor(
    configuration: OpenAIProviderConfiguration,
    fetchImplementation: typeof fetch = fetch,
  ) {
    if (
      !configuration.apiKey.trim() ||
      !configuration.textModel.trim() ||
      !configuration.transcriptionModel.trim()
    ) {
      throw new ProviderContractError(
        'INVALID_OPTIONS',
        'OpenAI API key and model names are required',
      );
    }
    this.#apiKey = configuration.apiKey;
    this.#textModel = configuration.textModel;
    this.#transcriptionModel = configuration.transcriptionModel;
    this.#baseUrl = validateBaseUrl(
      configuration.baseUrl ?? 'https://api.openai.com/v1',
      configuration.allowInsecurePrivateEndpoint ?? false,
    );
    this.#fetch = fetchImplementation;
  }

  async transcribe(
    audio: AudioPayload,
    options: TranscribeOptions,
  ): Promise<TranscriptResult> {
    const form = new FormData();
    const bytes = audio.bytes.slice().buffer;
    form.append(
      'file',
      new Blob([bytes], { type: audio.mimeType }),
      `recording.${extensionForMimeType(audio.mimeType)}`,
    );
    form.append('model', this.#transcriptionModel);
    form.append('language', options.language === 'zh-CN' ? 'zh' : 'en');
    if (options.dictionary.length > 0) {
      form.append(
        'prompt',
        `Preserve these terms exactly: ${options.dictionary.join(', ')}`,
      );
    }

    const response = await this.request('/audio/transcriptions', {
      body: form,
      method: 'POST',
      signal: options.signal,
    });
    const payload = (await response.json()) as OpenAITranscriptionResponse;
    if (!payload.text?.trim()) {
      throw new ProviderContractError(
        'EMPTY_RESULT',
        'OpenAI returned an empty transcript',
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

  async classifyIntent(
    text: string,
    context: IntentContext,
  ): Promise<IntentClassificationResult> {
    const output = await this.textResponse(
      text,
      `Classify the user's spoken text as transcription, translation, or instruction. Detect an explicitly spoken translation target if it is Simplified Chinese or English. The configured fallback target is ${context.defaultTargetLanguage}.`,
      context.signal,
      {
        format: {
          name: 'untypo_intent',
          schema: {
            additionalProperties: false,
            properties: {
              explicitTargetLanguage: {
                anyOf: [
                  { enum: ['zh-CN', 'en-US'], type: 'string' },
                  { type: 'null' },
                ],
              },
              intent: {
                enum: ['transcription', 'translation', 'instruction'],
                type: 'string',
              },
            },
            required: ['intent', 'explicitTargetLanguage'],
            type: 'object',
          },
          strict: true,
          type: 'json_schema',
        },
      },
    );
    const value: unknown = JSON.parse(output);
    if (
      typeof value !== 'object' ||
      value === null ||
      !('intent' in value) ||
      (value.intent !== 'transcription' &&
        value.intent !== 'translation' &&
        value.intent !== 'instruction')
    ) {
      throw new ProviderContractError(
        'INVALID_PROVIDER',
        'OpenAI returned an invalid intent classification',
      );
    }
    const explicitTargetLanguage =
      'explicitTargetLanguage' in value &&
      (value.explicitTargetLanguage === 'zh-CN' ||
        value.explicitTargetLanguage === 'en-US')
        ? value.explicitTargetLanguage
        : undefined;
    return {
      intent: value.intent,
      ...(explicitTargetLanguage ? { explicitTargetLanguage } : {}),
    };
  }

  translate(text: string, context: TranslationContext): Promise<string> {
    return this.textResponse(
      text,
      `Translate the input into ${context.targetLanguage}. Return only the translation while preserving meaning, formatting, and proper nouns.`,
      context.signal,
    );
  }

  generateFromInstruction(
    instructionText: string,
    context: GenerationContext,
  ): Promise<string> {
    const dictionary = context.dictionary.join(', ');
    return this.textResponse(
      instructionText,
      `Follow the spoken instruction and generate the requested content in ${context.locale}. Return only the finished content.${dictionary ? ` Preserve these terms exactly: ${dictionary}.` : ''}`,
      context.signal,
    );
  }

  polish(text: string, context: PolishContext): Promise<string> {
    const dictionary = context.dictionary.join(', ');
    return this.textResponse(
      text,
      `Polish this transcript in ${context.locale}. Remove filler words and repetition, correct errors, and preserve the speaker's meaning and formatting.${context.tone ? ` Use a ${context.tone} tone.` : ''}${dictionary ? ` Preserve these terms exactly: ${dictionary}.` : ''} Return only the polished text.`,
      context.signal,
    );
  }

  private async textResponse(
    input: string,
    instructions: string,
    signal?: AbortSignal,
    text?: Readonly<Record<string, unknown>>,
  ): Promise<string> {
    const response = await this.request('/responses', {
      body: JSON.stringify({
        input,
        instructions,
        model: this.#textModel,
        store: false,
        ...(text ? { text } : {}),
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      signal,
    });
    return extractOutputText((await response.json()) as OpenAIResponsePayload);
  }

  private async request(
    pathname: string,
    init: RequestInit,
  ): Promise<Response> {
    const response = await this.#fetch(`${this.#baseUrl}${pathname}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.#apiKey}`,
        ...init.headers,
      },
    });
    if (!response.ok) {
      let message = `OpenAI request failed with status ${String(response.status)}`;
      try {
        const payload = (await response.json()) as OpenAIErrorResponse;
        if (payload.error?.message) message = payload.error.message;
      } catch {
        message = `OpenAI request failed with status ${String(response.status)}`;
      }
      throw new Error(message);
    }
    return response;
  }
}
