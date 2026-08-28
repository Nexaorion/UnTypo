import {
  PROVIDER_CONTRACT_VERSION,
  ProviderContractError,
  type TextGenerationProvider,
  type TextProcessContext,
  type TextProcessResult,
} from './contracts.js';
import {
  isProviderEventStream,
  providerConfigSchema,
  providerUrl,
  readProviderEventStream,
  readProviderJson,
  resolveProviderConfiguration,
  type ProviderConnectionConfiguration,
} from './provider-http.js';
import {
  createTranscriptOutputTextStream,
  parseTranscriptProcessing,
  textProviderCapabilities,
  transcriptProcessingInstructions,
} from './text-provider-utils.js';

export type AnthropicTextProviderConfiguration =
  ProviderConnectionConfiguration;

interface AnthropicMessagePayload {
  content?: Array<{
    text?: string;
    type?: string;
  }>;
}

interface AnthropicStreamEvent {
  delta?: {
    text?: string;
    type?: string;
  };
  type?: string;
}

const extractText = (payload: unknown): string => {
  const text = ((payload as AnthropicMessagePayload).content ?? [])
    .filter((part) => part.type === 'text' && part.text?.trim())
    .map((part) => part.text)
    .join('');
  if (text.trim()) return text;
  throw new ProviderContractError(
    'EMPTY_RESULT',
    'Anthropic returned an empty response',
  );
};

export class AnthropicTextProvider implements TextGenerationProvider {
  readonly capabilities = textProviderCapabilities;
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
    configuration: AnthropicTextProviderConfiguration,
    fetchImplementation: typeof fetch = fetch,
  ) {
    const resolved = resolveProviderConfiguration(configuration, {
      baseUrl: 'https://api.anthropic.com/v1',
    });
    this.id = resolved.id;
    this.displayName = resolved.displayName;
    this.#apiKey = resolved.apiKey;
    this.#baseUrl = resolved.baseUrl;
    this.#model = resolved.model;
    this.#fetch = fetchImplementation;
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
    onTextDelta?: (delta: string) => void,
  ): Promise<string> {
    const response = await this.#fetch(
      providerUrl(this.#baseUrl, '/messages'),
      {
        body: JSON.stringify({
          max_tokens: 2_048,
          messages: [{ content: input, role: 'user' }],
          model: this.#model,
          stream: true,
          system: instructions,
        }),
        headers: {
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
          'x-api-key': this.#apiKey,
        },
        method: 'POST',
        signal,
      },
    );
    if (isProviderEventStream(response)) {
      let output = '';
      await readProviderEventStream(response, 'Anthropic', (event) => {
        const streamEvent = event as AnthropicStreamEvent;
        const delta = streamEvent.delta;
        if (
          streamEvent.type !== 'content_block_delta' ||
          delta?.type !== 'text_delta' ||
          typeof delta.text !== 'string'
        ) {
          return;
        }
        output += delta.text;
        onTextDelta?.(delta.text);
      });
      if (!output.trim()) {
        throw new ProviderContractError(
          'EMPTY_RESULT',
          'Anthropic returned an empty response',
        );
      }
      return output;
    }
    return extractText(await readProviderJson(response, 'Anthropic'));
  }
}
