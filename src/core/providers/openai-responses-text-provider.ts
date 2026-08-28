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

export type OpenAIResponsesTextProviderConfiguration =
  ProviderConnectionConfiguration;

interface ResponsesPayload {
  output?: Array<{
    content?: Array<{
      text?: string;
      type?: string;
    }>;
    type?: string;
  }>;
  output_text?: string;
}

interface ResponsesStreamEvent {
  delta?: string;
  type?: string;
}

const extractText = (payload: unknown): string => {
  const response = payload as ResponsesPayload;
  if (typeof response.output_text === 'string' && response.output_text.trim()) {
    return response.output_text;
  }
  const text = (response.output ?? [])
    .filter((item) => item.type === 'message')
    .flatMap((item) => item.content ?? [])
    .filter((part) => part.type === 'output_text' && part.text?.trim())
    .map((part) => part.text)
    .join('');
  if (text.trim()) return text;
  throw new ProviderContractError(
    'EMPTY_RESULT',
    'OpenAI Responses-compatible provider returned an empty response',
  );
};

export class OpenAIResponsesTextProvider implements TextGenerationProvider {
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
    configuration: OpenAIResponsesTextProviderConfiguration,
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
      providerUrl(this.#baseUrl, '/responses'),
      {
        body: JSON.stringify({
          input,
          instructions,
          model: this.#model,
          store: false,
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
        'OpenAI Responses-compatible provider',
        (event) => {
          const streamEvent = event as ResponsesStreamEvent;
          if (
            streamEvent.type !== 'response.output_text.delta' ||
            typeof streamEvent.delta !== 'string'
          ) {
            return;
          }
          output += streamEvent.delta;
          onTextDelta?.(streamEvent.delta);
        },
      );
      if (!output.trim()) {
        throw new ProviderContractError(
          'EMPTY_RESULT',
          'OpenAI Responses-compatible provider returned an empty response',
        );
      }
      return output;
    }
    return extractText(
      await readProviderJson(response, 'OpenAI Responses-compatible provider'),
    );
  }
}
