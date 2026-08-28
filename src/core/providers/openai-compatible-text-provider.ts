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

export type OpenAICompatibleTextProviderConfiguration =
  ProviderConnectionConfiguration;

interface ChatCompletionPayload {
  choices?: Array<{
    message?: {
      content?: string | Array<{ text?: string; type?: string }> | null;
    };
  }>;
}

interface ChatCompletionStreamEvent {
  choices?: Array<{
    delta?: {
      content?: string | Array<{ text?: string; type?: string }> | null;
    };
  }>;
}

const extractDeltaText = (event: unknown): string => {
  const content = (event as ChatCompletionStreamEvent).choices?.[0]?.delta
    ?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('');
};

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
      providerUrl(this.#baseUrl, '/chat/completions'),
      {
        body: JSON.stringify({
          messages: [
            { content: instructions, role: 'system' },
            { content: input, role: 'user' },
          ],
          model: this.#model,
          stream: true,
        }),
        headers: {
          Authorization: `Bearer ${this.#apiKey}`,
          'Content-Type': 'application/json',
        },
        method: 'POST',
        signal,
      },
    );
    if (isProviderEventStream(response)) {
      let output = '';
      await readProviderEventStream(
        response,
        'OpenAI-compatible provider',
        (event) => {
          const delta = extractDeltaText(event);
          if (!delta) return;
          output += delta;
          onTextDelta?.(delta);
        },
      );
      if (!output.trim()) {
        throw new ProviderContractError(
          'EMPTY_RESULT',
          'OpenAI-compatible provider returned an empty response',
        );
      }
      return output;
    }
    return extractText(
      await readProviderJson(response, 'OpenAI-compatible provider'),
    );
  }
}
