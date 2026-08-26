import {
  assertProcessResult,
  assertSpeechProviderContract,
  assertTextProviderContract,
  ProviderContractError,
  type AudioPayload,
  type DictationIntent,
  type DictationProvider,
  type IntentClassificationResult,
  type ProcessOptions,
  type ProcessResult,
  type SpeechRecognitionProvider,
  type TextGenerationProvider,
} from './contracts.js';

const throwIfAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) {
    throw new ProviderContractError('ABORTED', 'Dictation was cancelled');
  }
};

export class RecoverablePostProcessingError extends Error {
  readonly fallbackResult: ProcessResult;

  constructor(fallbackResult: ProcessResult, cause: unknown) {
    super('Text post-processing failed after transcription', { cause });
    this.name = 'RecoverablePostProcessingError';
    this.fallbackResult = fallbackResult;
  }
}

export class DictationPipeline {
  /** @deprecated Use speechProvider. */
  readonly provider: SpeechRecognitionProvider;
  readonly speechProvider: SpeechRecognitionProvider;
  readonly textProvider?: TextGenerationProvider;

  constructor(
    speechProvider: SpeechRecognitionProvider,
    textProvider?: TextGenerationProvider,
  ) {
    assertSpeechProviderContract(speechProvider);
    if (textProvider) assertTextProviderContract(textProvider);
    this.provider = speechProvider;
    this.speechProvider = speechProvider;
    this.textProvider = textProvider;
  }

  async process(
    audio: AudioPayload,
    options: ProcessOptions,
  ): Promise<ProcessResult> {
    throwIfAborted(options.signal);
    this.assertAudio(audio);

    const integratedProvider = this.integratedProvider();
    if (options.preferIntegratedProcess && integratedProvider?.process) {
      const result = await integratedProvider.process(audio, options);
      assertProcessResult(result);
      return result;
    }

    const transcript = await this.speechProvider.transcribe(audio, {
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

    if (!this.textProvider) {
      return {
        intent: 'transcription',
        outputText: rawTranscript,
        rawTranscript,
        usage: transcript.usage,
      };
    }

    const fallbackResult: ProcessResult = {
      intent: 'transcription',
      outputText: rawTranscript,
      rawTranscript,
      usage: transcript.usage,
    };

    try {
      const classification = await this.classify(rawTranscript, options);
      const outputText = await this.route(
        classification.intent,
        rawTranscript,
        options,
        classification.explicitTargetLanguage,
      );
      const result: ProcessResult = {
        intent: this.resolveAvailableIntent(classification.intent),
        outputText,
        rawTranscript,
        usage: transcript.usage,
      };

      assertProcessResult(result);
      return result;
    } catch (error) {
      throwIfAborted(options.signal);
      if (
        error instanceof ProviderContractError &&
        (error.code === 'ABORTED' || error.code === 'EMPTY_RESULT')
      ) {
        throw error;
      }
      throw new RecoverablePostProcessingError(fallbackResult, error);
    }
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
  ): Promise<IntentClassificationResult> {
    const provider = this.textProvider;
    if (!provider?.capabilities.intentDetection || !provider.classifyIntent) {
      return { intent: 'transcription' };
    }

    const classification = await provider.classifyIntent(transcript, {
      defaultTargetLanguage: options.defaultTargetLanguage,
      dictionary: options.dictionary,
      locale: options.language,
      signal: options.signal,
      windowContext: options.windowContext,
    });
    return typeof classification === 'string'
      ? { intent: classification }
      : classification;
  }

  private integratedProvider(): DictationProvider | undefined {
    if (!this.textProvider || this.speechProvider !== this.textProvider) {
      return undefined;
    }
    return this.speechProvider;
  }

  private resolveAvailableIntent(intent: DictationIntent): DictationIntent {
    const provider = this.textProvider;
    if (
      !provider ||
      (intent === 'translation' && !provider.capabilities.translation) ||
      (intent === 'instruction' && !provider.capabilities.instructionGeneration)
    ) {
      return 'transcription';
    }

    return intent;
  }

  private async route(
    requestedIntent: DictationIntent,
    transcript: string,
    options: ProcessOptions,
    classifiedTargetLanguage?: ProcessOptions['explicitTargetLanguage'],
  ): Promise<string> {
    const provider = this.textProvider;
    if (!provider) return transcript;
    const intent = this.resolveAvailableIntent(requestedIntent);
    throwIfAborted(options.signal);

    if (intent === 'translation') {
      if (!provider.translate) {
        throw new ProviderContractError(
          'UNSUPPORTED_CAPABILITY',
          `Provider ${provider.id} cannot translate`,
        );
      }

      return provider.translate(transcript, {
        signal: options.signal,
        targetLanguage:
          options.explicitTargetLanguage ??
          classifiedTargetLanguage ??
          options.defaultTargetLanguage,
      });
    }

    if (intent === 'instruction') {
      if (!provider.generateFromInstruction) {
        throw new ProviderContractError(
          'UNSUPPORTED_CAPABILITY',
          `Provider ${provider.id} cannot generate from instructions`,
        );
      }

      return provider.generateFromInstruction(transcript, {
        dictionary: options.dictionary,
        locale: options.language,
        profile:
          provider.kind === 'official-cloud' ? options.profile : undefined,
        signal: options.signal,
      });
    }

    if (provider.capabilities.textPolish && provider.polish) {
      return provider.polish(transcript, {
        dictionary: options.dictionary,
        locale: options.language,
        signal: options.signal,
        tone: options.tone,
      });
    }

    return transcript;
  }
}
