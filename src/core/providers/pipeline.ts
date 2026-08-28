import {
  assertProcessResult,
  assertSpeechProviderContract,
  assertTextProviderContract,
  ProviderContractError,
  type AudioPayload,
  type DictationProvider,
  type ModelCallTrace,
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

const elapsedSince = (startedAt: number): number =>
  Math.max(0, Date.now() - startedAt);

const traceError = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error))
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 180);

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

    const modelCalls: ModelCallTrace[] = [];
    const speechStartedAt = Date.now();
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
    modelCalls.push({
      durationMs: elapsedSince(speechStartedAt),
      input: {
        audioDurationMs: audio.durationMs,
        channels: audio.channels,
        dictionaryTermCount: options.dictionary.length,
        language: options.language,
        mimeType: audio.mimeType,
        payloadSizeBytes: audio.bytes.byteLength,
        sampleRateHz: audio.sampleRateHz,
      },
      kind: 'speech-recognition',
      outputText: rawTranscript,
      providerId: this.speechProvider.id,
      status: 'success',
    });

    if (!this.textProvider) {
      return {
        intent: 'transcription',
        modelCalls,
        outputText: rawTranscript,
        rawTranscript,
        usage: transcript.usage,
      };
    }

    const forcedIntent =
      options.forcedIntent ??
      (this.textProvider.capabilities.intentDetection
        ? undefined
        : 'transcription');
    const textInput = {
      defaultTargetLanguage: options.defaultTargetLanguage,
      dictionaryLearningEnabled: options.dictionaryLearningEnabled === true,
      dictionaryTermCount: options.dictionary.length,
      ...(options.explicitTargetLanguage
        ? { explicitTargetLanguage: options.explicitTargetLanguage }
        : {}),
      ...(forcedIntent ? { forcedIntent } : {}),
      locale: options.language,
      text: rawTranscript,
      ...(options.tone ? { tone: options.tone } : {}),
    };
    const textStartedAt = Date.now();
    let firstOutputMs: number | undefined;
    try {
      const processed = await this.textProvider.processTranscript(
        rawTranscript,
        {
          defaultTargetLanguage: options.defaultTargetLanguage,
          dictionary: options.dictionary,
          ...(options.dictionaryLearningEnabled !== undefined
            ? {
                dictionaryLearningEnabled: options.dictionaryLearningEnabled,
              }
            : {}),
          ...(options.explicitTargetLanguage
            ? { explicitTargetLanguage: options.explicitTargetLanguage }
            : {}),
          ...(forcedIntent ? { forcedIntent } : {}),
          locale: options.language,
          onOutputTextUpdate: (outputText) => {
            firstOutputMs ??= elapsedSince(textStartedAt);
            options.onOutputTextUpdate?.(outputText);
          },
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
        ...(processed.dictionaryCandidates
          ? { dictionaryCandidates: processed.dictionaryCandidates }
          : {}),
        intent: processed.intent,
        modelCalls: [
          ...modelCalls,
          {
            durationMs: elapsedSince(textStartedAt),
            ...(firstOutputMs === undefined ? {} : { firstOutputMs }),
            input: textInput,
            kind: 'text-generation',
            outputText: processed.outputText,
            providerId: this.textProvider.id,
            status: 'success',
          },
        ],
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
      const fallbackResult: ProcessResult = {
        intent: 'transcription',
        modelCalls: [
          ...modelCalls,
          {
            durationMs: elapsedSince(textStartedAt),
            error: traceError(error),
            ...(firstOutputMs === undefined ? {} : { firstOutputMs }),
            input: textInput,
            kind: 'text-generation',
            providerId: this.textProvider.id,
            status: 'failed',
          },
        ],
        outputText: rawTranscript,
        rawTranscript,
        usage: transcript.usage,
      };
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
