import {
  assertProcessResult,
  assertProviderContract,
  ProviderContractError,
  type AudioPayload,
  type DictationIntent,
  type DictationProvider,
  type ProcessOptions,
  type ProcessResult,
} from './contracts.js';

const throwIfAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) {
    throw new ProviderContractError('ABORTED', 'Dictation was cancelled');
  }
};

export class DictationPipeline {
  readonly provider: DictationProvider;

  constructor(provider: DictationProvider) {
    assertProviderContract(provider);
    this.provider = provider;
  }

  async process(
    audio: AudioPayload,
    options: ProcessOptions,
  ): Promise<ProcessResult> {
    throwIfAborted(options.signal);
    this.assertAudio(audio);

    if (options.preferIntegratedProcess && this.provider.process) {
      const result = await this.provider.process(audio, options);
      assertProcessResult(result);
      return result;
    }

    const transcript = await this.provider.transcribe(audio, {
      dictionary: options.dictionary,
      language: options.language,
      signal: options.signal,
    });
    throwIfAborted(options.signal);

    const rawTranscript = transcript.text.trim();
    if (!rawTranscript) {
      throw new ProviderContractError(
        'EMPTY_RESULT',
        'Provider returned an empty transcript',
      );
    }

    const intent = await this.classify(rawTranscript, options);
    const outputText = await this.route(intent, rawTranscript, options);
    const result: ProcessResult = {
      intent: this.resolveAvailableIntent(intent),
      outputText,
      rawTranscript,
      usage: transcript.usage,
    };

    assertProcessResult(result);
    return result;
  }

  private assertAudio(audio: AudioPayload): void {
    if (
      audio.bytes.byteLength === 0 ||
      audio.channels < 1 ||
      audio.durationMs <= 0 ||
      audio.sampleRateHz <= 0 ||
      !audio.mimeType.trim()
    ) {
      throw new ProviderContractError(
        'INVALID_OPTIONS',
        'Audio payload is incomplete',
      );
    }
  }

  private async classify(
    transcript: string,
    options: ProcessOptions,
  ): Promise<DictationIntent> {
    if (
      !this.provider.capabilities.intentDetection ||
      !this.provider.classifyIntent
    ) {
      return 'transcription';
    }

    return this.provider.classifyIntent(transcript, {
      defaultTargetLanguage: options.defaultTargetLanguage,
      dictionary: options.dictionary,
      locale: options.language,
      signal: options.signal,
    });
  }

  private resolveAvailableIntent(intent: DictationIntent): DictationIntent {
    if (
      (intent === 'translation' && !this.provider.capabilities.translation) ||
      (intent === 'instruction' &&
        !this.provider.capabilities.instructionGeneration)
    ) {
      return 'transcription';
    }

    return intent;
  }

  private async route(
    requestedIntent: DictationIntent,
    transcript: string,
    options: ProcessOptions,
  ): Promise<string> {
    const intent = this.resolveAvailableIntent(requestedIntent);
    throwIfAborted(options.signal);

    if (intent === 'translation') {
      if (!this.provider.translate) {
        throw new ProviderContractError(
          'UNSUPPORTED_CAPABILITY',
          `Provider ${this.provider.id} cannot translate`,
        );
      }

      return this.provider.translate(transcript, {
        signal: options.signal,
        targetLanguage:
          options.explicitTargetLanguage ?? options.defaultTargetLanguage,
      });
    }

    if (intent === 'instruction') {
      if (!this.provider.generateFromInstruction) {
        throw new ProviderContractError(
          'UNSUPPORTED_CAPABILITY',
          `Provider ${this.provider.id} cannot generate from instructions`,
        );
      }

      return this.provider.generateFromInstruction(transcript, {
        dictionary: options.dictionary,
        locale: options.language,
        profile: options.profile,
        signal: options.signal,
      });
    }

    if (this.provider.capabilities.textPolish && this.provider.polish) {
      return this.provider.polish(transcript, {
        dictionary: options.dictionary,
        locale: options.language,
        signal: options.signal,
        tone: options.tone,
      });
    }

    return transcript;
  }
}
