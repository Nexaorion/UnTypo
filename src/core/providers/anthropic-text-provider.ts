import {
  PROVIDER_CONTRACT_VERSION,
  ProviderContractError,
  type TextGenerationProvider,
  type TextProcessContext,
  type TextProcessResult,
} from './contracts.js';
import {
  providerConfigSchema,
  providerUrl,
  readProviderJson,
  resolveProviderConfiguration,
  type ProviderConnectionConfiguration,
} from './provider-http.js';
import {
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
    return parseTranscriptProcessing(
      await this.textResponse(
        text,
        transcriptProcessingInstructions(context),
        context.signal,
      ),
    );
  }

  private async textResponse(
    input: string,
    instructions: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const response = await this.#fetch(
      providerUrl(this.#baseUrl, '/messages'),
      {
        body: JSON.stringify({
          max_tokens: 2_048,
          messages: [{ content: input, role: 'user' }],
          model: this.#model,
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
    return extractText(await readProviderJson(response, 'Anthropic'));
  }
}
