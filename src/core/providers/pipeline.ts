import {
  assertProcessResult,
  assertSpeechProviderContract,
  assertTextProviderContract,
  ProviderContractError,
  type AudioPayload,
  type DictationProvider,
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
      const forcedIntent =
        options.fastMode && options.forcedIntent
          ? options.forcedIntent
          : this.textProvider.capabilities.intentDetection
            ? undefined
            : 'transcription';
      const processed = await this.textProvider.processTranscript(
        rawTranscript,
        {
          defaultTargetLanguage: options.defaultTargetLanguage,
          dictionary: options.dictionary,
          ...(options.explicitTargetLanguage
            ? { explicitTargetLanguage: options.explicitTargetLanguage }
            : {}),
          ...(forcedIntent ? { forcedIntent } : {}),
          locale: options.language,
          ...(this.textProvider.kind === 'official-cloud' && options.profile
            ? { profile: options.profile }
            : {}),
          signal: options.signal,
          ...(options.tone ? { tone: options.tone } : {}),
          ...(options.windowContext
            ? { windowContext: options.windowContext }
            : {}),
        },
      );
      if (forcedIntent && processed.intent !== forcedIntent) {
        throw new ProviderContractError(
          'INVALID_PROVIDER',
          `Text provider ignored the forced ${forcedIntent} intent`,
        );
      }
      const result: ProcessResult = {
        intent: processed.intent,
        outputText: processed.outputText,
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

  private integratedProvider(): DictationProvider | undefined {
    if (
      !this.textProvider ||
      !Object.is(this.speechProvider, this.textProvider)
    ) {
      return undefined;
    }
    return this.speechProvider as DictationProvider;
  }
}
