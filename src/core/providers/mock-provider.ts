import {
  PROVIDER_CONTRACT_VERSION,
  type AudioPayload,
  type DictationIntent,
  type DictationProvider,
  type ProcessOptions,
  type ProcessResult,
  type ProviderCapabilities,
  type TextProcessContext,
  type TextProcessResult,
  type TranscriptResult,
} from './contracts.js';
import type { DictionaryCandidate } from '../../shared/dictionary.js';
import type { WritingPreferenceCandidate } from '../../shared/personalization.js';

export interface MockProviderScenario {
  dictionaryCandidates?: readonly DictionaryCandidate[];
  generatedText?: string;
  explicitTargetLanguage?: 'zh-CN' | 'en-US';
  intent?: DictationIntent;
  polishedText?: string;
  preferenceCandidates?: readonly WritingPreferenceCandidate[];
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

  async processTranscript(
    text: string,
    context: TextProcessContext,
  ): Promise<TextProcessResult> {
    const intent =
      context.forcedIntent ??
      (this.capabilities.intentDetection
        ? (this.#scenario.intent ?? 'transcription')
        : 'transcription');
    const targetLanguage =
      context.explicitTargetLanguage ??
      this.#scenario.explicitTargetLanguage ??
      context.defaultTargetLanguage;
    const outputText =
      intent === 'translation'
        ? (this.#scenario.translatedText?.[targetLanguage] ?? text)
        : intent === 'instruction'
          ? (this.#scenario.generatedText ?? text)
          : (this.#scenario.polishedText ?? text);

    context.onOutputTextUpdate?.(outputText);

    return Promise.resolve({
      ...(context.dictionaryLearningEnabled &&
      this.#scenario.dictionaryCandidates
        ? { dictionaryCandidates: this.#scenario.dictionaryCandidates }
        : {}),
      intent,
      outputText,
      ...(context.preferenceLearningEnabled &&
      this.#scenario.preferenceCandidates
        ? { preferenceCandidates: this.#scenario.preferenceCandidates }
        : {}),
    });
  }

  async process(
    audio: AudioPayload,
    options: ProcessOptions,
  ): Promise<ProcessResult> {
    const transcript = await this.transcribe(audio);
    const processed = await this.processTranscript(transcript.text, {
      defaultTargetLanguage: options.defaultTargetLanguage,
      dictionary: options.dictionary,
      ...(options.dictionaryLearningEnabled !== undefined
        ? { dictionaryLearningEnabled: options.dictionaryLearningEnabled }
        : {}),
      ...(options.explicitTargetLanguage
        ? { explicitTargetLanguage: options.explicitTargetLanguage }
        : {}),
      ...(options.forcedIntent ? { forcedIntent: options.forcedIntent } : {}),
      ...(options.learnedPreferences
        ? { learnedPreferences: options.learnedPreferences }
        : {}),
      locale: options.language,
      ...(options.onOutputTextUpdate
        ? { onOutputTextUpdate: options.onOutputTextUpdate }
        : {}),
      signal: options.signal,
      ...(options.preferenceLearningEnabled !== undefined
        ? { preferenceLearningEnabled: options.preferenceLearningEnabled }
        : {}),
      ...(options.tone ? { tone: options.tone } : {}),
      ...(options.windowContext
        ? { windowContext: options.windowContext }
        : {}),
      ...(options.writingStyle ? { writingStyle: options.writingStyle } : {}),
    });

    return {
      ...(processed.dictionaryCandidates
        ? { dictionaryCandidates: processed.dictionaryCandidates }
        : {}),
      intent: processed.intent,
      outputText: processed.outputText,
      ...(processed.preferenceCandidates
        ? { preferenceCandidates: processed.preferenceCandidates }
        : {}),
      rawTranscript: transcript.text,
      usage: transcript.usage,
    };
  }
}
