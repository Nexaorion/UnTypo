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

export type OpenAICompatibleTextProviderConfiguration =
  ProviderConnectionConfiguration;

interface ChatCompletionPayload {
  choices?: Array<{
    message?: {
      content?: string | Array<{ text?: string; type?: string }> | null;
    };
  }>;
}

const extractText = (payload: unknown): string => {
  const content = (payload as ChatCompletionPayload).choices?.[0]?.message
    ?.content;
  if (typeof content === 'string' && content.trim()) return content;
  if (Array.isArray(content)) {
    const text = content
      .filter((part) => part.type === 'text' && part.text?.trim())
      .map((part) => part.text)
      .join('');
    if (text.trim()) return text;
  }
  throw new ProviderContractError(
    'EMPTY_RESULT',
    'OpenAI-compatible provider returned an empty response',
  );
};

export class OpenAICompatibleTextProvider implements TextGenerationProvider {
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
    configuration: OpenAICompatibleTextProviderConfiguration,
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
      providerUrl(this.#baseUrl, '/chat/completions'),
      {
        body: JSON.stringify({
          messages: [
            { content: instructions, role: 'system' },
            { content: input, role: 'user' },
          ],
          model: this.#model,
        }),
        headers: {
          Authorization: `Bearer ${this.#apiKey}`,
          'Content-Type': 'application/json',
        },
        method: 'POST',
        signal,
      },
    );
    return extractText(
      await readProviderJson(response, 'OpenAI-compatible provider'),
    );
  }
}
