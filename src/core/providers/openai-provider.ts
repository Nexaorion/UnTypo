import {
  PROVIDER_CONTRACT_VERSION,
  ProviderContractError,
  type AudioPayload,
  type DictationProvider,
  type ProviderCapabilities,
  type TextProcessContext,
  type TextProcessResult,
  type TranscriptResult,
  type TranscribeOptions,
} from './contracts.js';
import {
  createTranscriptOutputTextStream,
  parseTranscriptProcessing,
  transcriptProcessingInstructions,
} from './text-provider-utils.js';
import {
  isProviderEventStream,
  readProviderEventStream,
} from './provider-http.js';

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

interface OpenAIResponseStreamEvent {
  delta?: string;
  type?: string;
}

const capabilities: ProviderCapabilities = {
  speechToText: true,
  textPolish: true,
  toneAdaptation: true,
  translation: true,
  instructionGeneration: true,
  intentDetection: true,
  streamingPartial: true,
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
    const bytes = Uint8Array.from(audio.bytes).buffer;
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

  async processTranscript(
    text: string,
    context: TextProcessContext,
  ): Promise<TextProcessResult> {
    const outputTextStream = createTranscriptOutputTextStream(
      context.onOutputTextUpdate,
    );
    const output = await this.textResponse(
      text,
      transcriptProcessingInstructions(context),
      context.signal,
      {
        format: {
          name: 'untypo_transcript_result',
          schema: {
            additionalProperties: false,
            properties: {
              outputText: { minLength: 1, type: 'string' },
              intent: {
                enum: ['transcription', 'translation', 'instruction'],
                type: 'string',
              },
              ...(context.dictionaryLearningEnabled
                ? {
                    dictionaryCandidates: {
                      items: {
                        additionalProperties: false,
                        properties: {
                          category: {
                            enum: [
                              'person',
                              'place',
                              'organization',
                              'product',
                              'technical',
                            ],
                            type: 'string',
                          },
                          confidence: {
                            maximum: 1,
                            minimum: 0,
                            type: 'number',
                          },
                          term: { minLength: 1, type: 'string' },
                        },
                        required: ['term', 'category', 'confidence'],
                        type: 'object',
                      },
                      type: 'array',
                    },
                  }
                : {}),
              ...(context.preferenceLearningEnabled
                ? {
                    preferenceCandidates: {
                      items: {
                        additionalProperties: false,
                        properties: {
                          confidence: {
                            maximum: 1,
                            minimum: 0,
                            type: 'number',
                          },
                          kind: {
                            enum: [
                              'emoji',
                              'expression',
                              'punctuation',
                              'structure',
                              'tone',
                              'verbosity',
                            ],
                            type: 'string',
                          },
                          value: {
                            maxLength: 40,
                            minLength: 1,
                            type: 'string',
                          },
                        },
                        required: ['kind', 'value', 'confidence'],
                        type: 'object',
                      },
                      maxItems: 2,
                      type: 'array',
                    },
                  }
                : {}),
            },
            required: [
              'outputText',
              'intent',
              ...(context.dictionaryLearningEnabled
                ? ['dictionaryCandidates']
                : []),
              ...(context.preferenceLearningEnabled
                ? ['preferenceCandidates']
                : []),
            ],
            type: 'object',
          },
          strict: true,
          type: 'json_schema',
        },
      },
      outputTextStream.push,
    );
    const result = parseTranscriptProcessing(output);
    outputTextStream.complete(result.outputText);
    return result;
  }

  private async textResponse(
    input: string,
    instructions: string,
    signal?: AbortSignal,
    text?: Readonly<Record<string, unknown>>,
    onTextDelta?: (delta: string) => void,
  ): Promise<string> {
    const response = await this.request('/responses', {
      body: JSON.stringify({
        input,
        instructions,
        model: this.#textModel,
        store: false,
        stream: true,
        ...(text ? { text } : {}),
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      signal,
    });
    if (isProviderEventStream(response)) {
      let output = '';
      await readProviderEventStream(response, 'OpenAI', (event) => {
        const streamEvent = event as OpenAIResponseStreamEvent;
        if (
          streamEvent.type !== 'response.output_text.delta' ||
          typeof streamEvent.delta !== 'string'
        ) {
          return;
        }
        output += streamEvent.delta;
        onTextDelta?.(streamEvent.delta);
      });
      if (!output.trim()) {
        throw new ProviderContractError(
          'EMPTY_RESULT',
          'OpenAI returned an empty response',
        );
      }
      return output;
    }
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
