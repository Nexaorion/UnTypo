import {
  PROVIDER_CONTRACT_VERSION,
  type AudioPayload,
  type DictationIntent,
  type DictationProvider,
  type ProcessOptions,
  type ProcessResult,
  type ProviderCapabilities,
  type TranscriptResult,
  type TranslationContext,
} from './contracts.js';

export interface MockProviderScenario {
  generatedText?: string;
  intent?: DictationIntent;
  polishedText?: string;
  transcript?: string;
  translatedText?: Partial<Record<'zh-CN' | 'en-US', string>>;
}

const fullCapabilities: ProviderCapabilities = {
  speechToText: true,
  textPolish: true,
  toneAdaptation: true,
  translation: true,
  instructionGeneration: true,
  intentDetection: true,
  streamingPartial: false,
};

export class MockDictationProvider implements DictationProvider {
  readonly capabilities: Readonly<ProviderCapabilities>;
  readonly configSchema = {
    additionalProperties: false,
    properties: {},
    type: 'object',
  } as const;
  readonly contractVersion = PROVIDER_CONTRACT_VERSION;
  readonly displayName = 'Mock Provider';
  readonly id = 'mock';
  readonly kind = 'builtin' as const;
  readonly #scenario: MockProviderScenario;

  constructor(
    scenario: MockProviderScenario = {},
    capabilities: Partial<ProviderCapabilities> = {},
  ) {
    this.#scenario = scenario;
    this.capabilities = { ...fullCapabilities, ...capabilities };
  }

  async transcribe(audio: AudioPayload): Promise<TranscriptResult> {
    return Promise.resolve({
      text: this.#scenario.transcript ?? 'mock transcript',
      usage: { audioDurationMs: audio.durationMs },
    });
  }

  async classifyIntent(): Promise<DictationIntent> {
    return Promise.resolve(this.#scenario.intent ?? 'transcription');
  }

  async polish(): Promise<string> {
    return Promise.resolve(
      this.#scenario.polishedText ??
        this.#scenario.transcript ??
        'mock transcript',
    );
  }

  async translate(text: string, context: TranslationContext): Promise<string> {
    return Promise.resolve(
      this.#scenario.translatedText?.[context.targetLanguage] ?? text,
    );
  }

  async generateFromInstruction(instructionText: string): Promise<string> {
    return Promise.resolve(this.#scenario.generatedText ?? instructionText);
  }

  async process(
    audio: AudioPayload,
    options: ProcessOptions,
  ): Promise<ProcessResult> {
    const transcript = await this.transcribe(audio);
    const intent = this.#scenario.intent ?? 'transcription';
    let outputText: string;

    if (intent === 'translation') {
      outputText = await this.translate(transcript.text, {
        signal: options.signal,
        targetLanguage:
          options.explicitTargetLanguage ?? options.defaultTargetLanguage,
      });
    } else if (intent === 'instruction') {
      outputText = await this.generateFromInstruction(transcript.text);
    } else {
      outputText = await this.polish();
    }

    return {
      intent,
      outputText,
      rawTranscript: transcript.text,
      usage: transcript.usage,
    };
  }
}
