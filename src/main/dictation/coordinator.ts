import {
  DictationPipeline,
  RecoverablePostProcessingError,
} from '../../core/providers/pipeline.js';
import { randomUUID } from 'node:crypto';
import type {
  ProcessOptions,
  ProcessResult,
  ProviderAudioFormat,
  SupportedLanguage,
  TextGenerationCallTrace,
} from '../../core/providers/contracts.js';
import type { DictionaryCandidate } from '../../shared/dictionary.js';
import { ProviderContractError } from '../../core/providers/contracts.js';
import type {
  SpeechProviderRegistry,
  TextProviderRegistry,
} from '../../core/providers/registry.js';
import type { CapsuleErrorReason } from '../../shared/capsule-ipc.js';
import type {
  ClientHistoryModelCall,
  ModelProviderId,
} from '../../shared/ipc.js';
import type { MicrophoneSelection } from '../../shared/microphone.js';
import type { HistoryPolicy } from '../storage/configuration.js';
import type { NewHistoryRecord } from '../storage/history.js';
import type {
  CompletedRecording,
  TargetSnapshot,
} from '../recording/session.js';
import type {
  NativeHotkeyAction,
  NativeTargetSnapshot,
} from '../native/protocol.js';
import { NativeHotkeyAction as HotkeyAction } from '../native/protocol.js';
import type {
  DiagnosticIssueInput,
  DiagnosticLogInput,
} from '../diagnostics/collector.js';

export type DictationRuntimeState = 'idle' | 'recording' | 'processing';

export interface RecorderPort {
  start: (
    target: TargetSnapshot,
    microphoneSelection?: MicrophoneSelection,
    outputFormat?: ProviderAudioFormat,
  ) => Promise<string>;
  stop: () => Promise<CompletedRecording>;
}

export interface NativeTargetPort {
  captureTarget: () => Promise<NativeTargetSnapshot>;
}

export interface InjectionPort {
  inject: (
    text: string,
    target: NativeTargetSnapshot,
  ) => Promise<{ injected: boolean }>;
}

export interface DictationPresenter {
  showConfirm: (result: ProcessResult) => Promise<boolean> | boolean;
  showError: (
    reason: CapsuleErrorReason,
    detail?: string,
  ) => void | Promise<void>;
  showProcessing: () => void | Promise<void>;
  showRecording: () => void | Promise<void>;
  showSuccess: (
    result: ProcessResult,
    delivery: 'copy' | 'inserted',
  ) => number | undefined | Promise<number | undefined>;
  updateProcessing: (outputText: string) => void;
}

export interface DictionaryLearningPort {
  handleCandidates: (
    candidates: readonly DictionaryCandidate[],
    successPresentationGeneration: number,
  ) => unknown;
}

export interface HistoryPort {
  record: (input: NewHistoryRecord, policy: HistoryPolicy) => unknown;
}

export interface DictationContext {
  fastMode?: boolean;
  history: HistoryPolicy;
  modelName?: string;
  microphoneSelection?: MicrophoneSelection;
  options: ProcessOptions;
  speechProviderId: string;
  speechProviderDetails?: DictationProviderTraceDetails;
  textProviderId?: string;
  textProviderDetails?: DictationProviderTraceDetails;
  uiLanguage: SupportedLanguage;
}

export interface DictationProviderTraceDetails {
  modelName: string;
  providerName: string;
  providerType: ModelProviderId;
}

export interface DictationCoordinatorDependencies {
  diagnostics?: {
    log: (input: DiagnosticLogInput) => unknown;
    recordIssue: (input: DiagnosticIssueInput) => unknown;
    runWithOperation: <T>(
      operationId: string,
      action: () => Promise<T>,
    ) => Promise<T>;
  };
  dictionaryLearning?: DictionaryLearningPort;
  getContext: () => DictationContext | Promise<DictationContext>;
  history: HistoryPort;
  injection: InjectionPort;
  native: NativeTargetPort;
  presenter: DictationPresenter;
  recorder: RecorderPort;
  speechProviders: SpeechProviderRegistry;
  textProviders: TextProviderRegistry;
}

const toRecordingTarget = (target: NativeTargetSnapshot): TargetSnapshot => ({
  processId: target.processId,
  windowHandle: target.windowHandle,
});

const errorDetail = (error: unknown): string | undefined => {
  if (!(error instanceof Error) || !error.message.trim()) return undefined;
  return error.message.replace(/\s+/gu, ' ').trim().slice(0, 180);
};

const hasUsableSignal = (recording: CompletedRecording): boolean =>
  recording.audio.bytes.byteLength >= 1_024 && recording.peakLevel >= 0.005;

const elapsedSince = (startedAt: number): number =>
  Math.max(0, Date.now() - startedAt);

const enrichModelCalls = (
  calls: ProcessResult['modelCalls'],
  context: DictationContext,
): readonly ClientHistoryModelCall[] =>
  (calls ?? []).map((call) => {
    const details =
      call.kind === 'speech-recognition'
        ? context.speechProviderDetails
        : context.textProviderDetails;
    return { ...call, ...(details ?? {}) };
  });

export class DictationCoordinator {
  readonly #dependencies: DictationCoordinatorDependencies;
  #context?: DictationContext;
  #operationId?: string;
  #state: DictationRuntimeState = 'idle';
  #target?: NativeTargetSnapshot;

  constructor(dependencies: DictationCoordinatorDependencies) {
    this.#dependencies = dependencies;
  }

  get state(): DictationRuntimeState {
    return this.#state;
  }

  async handleHotkey(action: NativeHotkeyAction): Promise<void> {
    if (action !== HotkeyAction.Toggle) return;
    if (this.#state === 'idle') await this.start();
    else if (this.#state === 'recording') await this.stop();
  }

  async start(): Promise<void> {
    if (this.#state !== 'idle') return;
    const operationId = randomUUID();
    this.#operationId = operationId;
    this.log({
      message: 'Dictation recording requested',
      scope: 'dictation.lifecycle',
    });
    let context: DictationContext;
    let recordingFormat: ProviderAudioFormat;
    try {
      context = await this.#dependencies.getContext();
      const speechProvider = this.#dependencies.speechProviders.require(
        context.speechProviderId,
      );
      recordingFormat = speechProvider.preferredAudioFormat ?? 'webm';
      if (context.textProviderId) {
        this.#dependencies.textProviders.require(context.textProviderId);
      }
    } catch (error) {
      this.recordIssue({
        error,
        kind: 'configuration',
        source: 'dictation.configuration',
      });
      await this.present(() =>
        this.#dependencies.presenter.showError(
          'configuration',
          errorDetail(error),
        ),
      );
      this.#operationId = undefined;
      throw error;
    }

    let target: NativeTargetSnapshot;
    try {
      target = await this.#dependencies.native.captureTarget();
    } catch (error) {
      this.recordIssue({
        error,
        kind: 'internal',
        source: 'dictation.target',
      });
      await this.present(() =>
        this.#dependencies.presenter.showError('unknown', errorDetail(error)),
      );
      this.#operationId = undefined;
      throw error;
    }

    try {
      await this.#dependencies.recorder.start(
        toRecordingTarget(target),
        context.microphoneSelection,
        recordingFormat,
      );
    } catch (error) {
      this.recordIssue({
        context: {
          microphoneSelection: context.microphoneSelection
            ? 'configured'
            : 'system-default',
        },
        error,
        kind: 'microphone',
        source: 'recorder.start',
      });
      await this.present(() =>
        this.#dependencies.presenter.showError(
          'microphone',
          errorDetail(error),
        ),
      );
      this.#operationId = undefined;
      throw error;
    }

    this.#context = context;
    this.#target = target;
    this.#state = 'recording';
    this.log({
      context: {
        microphoneSelection: context.microphoneSelection
          ? 'configured'
          : 'system-default',
        speechProviderId: context.speechProviderId,
        textProviderEnabled: context.textProviderId !== undefined,
      },
      message: 'Dictation recording started',
      scope: 'dictation.lifecycle',
    });
    await this.present(() => this.#dependencies.presenter.showRecording());
  }

  async stop(): Promise<void> {
    if (this.#state !== 'recording' || !this.#target || !this.#context) return;
    this.#state = 'processing';
    const target = this.#target;
    const context = this.#context;
    const operationId = this.#operationId ?? randomUUID();
    const processingStartedAt = Date.now();
    this.log({
      message: 'Dictation recording stop requested',
      operationId,
      scope: 'dictation.lifecycle',
    });
    await this.present(() => this.#dependencies.presenter.showProcessing());
    try {
      let recording: CompletedRecording;
      const recorderStartedAt = Date.now();
      let recorderFinalizationMs = 0;
      try {
        recording = await this.#dependencies.recorder.stop();
        recorderFinalizationMs = elapsedSince(recorderStartedAt);
      } catch (error) {
        this.recordIssue({
          error,
          kind: 'microphone',
          operationId,
          source: 'recorder.stop',
        });
        await this.present(() =>
          this.#dependencies.presenter.showError(
            'microphone',
            errorDetail(error),
          ),
        );
        throw error;
      }

      this.log({
        context: {
          channels: recording.audio.channels,
          durationMs: recording.audio.durationMs,
          mimeType: recording.audio.mimeType,
          payloadSizeBytes: recording.audio.bytes.byteLength,
          peakLevel: recording.peakLevel,
          sampleRateHz: recording.audio.sampleRateHz,
          speechDurationMs: recording.speechDurationMs,
          voiceDetected: recording.voiceDetected,
        },
        message: 'Recording captured for processing',
        operationId,
        scope: 'recorder.capture',
      });

      if (!hasUsableSignal(recording)) {
        const error = new Error('No microphone signal was detected');
        this.recordIssue({
          audio: recording.audio,
          context: {
            durationMs: recording.audio.durationMs,
            payloadSizeBytes: recording.audio.bytes.byteLength,
            peakLevel: recording.peakLevel,
          },
          error,
          kind: 'microphone',
          operationId,
          source: 'recorder.signal',
        });
        await this.present(() =>
          this.#dependencies.presenter.showError(
            'microphone',
            context.uiLanguage === 'zh-CN'
              ? '没有检测到麦克风声音，请在设置中选择其他麦克风'
              : 'No microphone signal detected. Choose another microphone in Settings.',
          ),
        );
        throw error;
      }

      if (!recording.voiceDetected) {
        this.log({
          context: {
            durationMs: recording.audio.durationMs,
            peakLevel: recording.peakLevel,
            speechDurationMs: recording.speechDurationMs,
          },
          message:
            'Recording skipped because no local voice activity was detected',
          operationId,
          scope: 'recorder.voice-activity',
        });
        await this.present(() =>
          this.#dependencies.presenter.showError('no-speech'),
        );
        return;
      }

      const speechProvider = this.#dependencies.speechProviders.require(
        context.speechProviderId,
      );
      const textProvider = context.textProviderId
        ? this.#dependencies.textProviders.require(context.textProviderId)
        : undefined;
      const processingSignal = context.options.signal
        ? AbortSignal.any([context.options.signal, AbortSignal.timeout(60_000)])
        : AbortSignal.timeout(60_000);
      let result: ProcessResult;
      let modelProcessingMs = 0;
      const modelProcessingStartedAt = Date.now();
      try {
        const processRecording = () =>
          new DictationPipeline(speechProvider, textProvider).process(
            recording.audio,
            {
              ...context.options,
              ...(context.fastMode
                ? { fastMode: true, forcedIntent: 'transcription' }
                : {}),
              onOutputTextUpdate: (outputText) => {
                context.options.onOutputTextUpdate?.(outputText);
                this.#dependencies.presenter.updateProcessing(outputText);
              },
              signal: processingSignal,
              windowContext: target
                ? {
                    isTextEntry: target.editable,
                    processId: target.processId,
                    windowHandle: target.windowHandle,
                  }
                : undefined,
            },
          );
        result = this.#dependencies.diagnostics
          ? await this.#dependencies.diagnostics.runWithOperation(
              operationId,
              processRecording,
            )
          : await processRecording();
        modelProcessingMs = elapsedSince(modelProcessingStartedAt);
      } catch (error) {
        modelProcessingMs = elapsedSince(modelProcessingStartedAt);
        if (error instanceof RecoverablePostProcessingError) {
          console.error(
            'Dictation text post-processing failed; using raw transcript',
            error.cause,
          );
          this.recordIssue({
            context: {
              fallbackUsed: true,
              speechProviderId: speechProvider.id,
            },
            error: error.cause,
            kind: 'provider',
            operationId,
            source: 'provider.post-processing',
          });
          result = error.fallbackResult;
        } else {
          const reason: CapsuleErrorReason =
            error instanceof ProviderContractError &&
            error.code === 'EMPTY_RESULT'
              ? 'empty'
              : 'provider';
          this.recordIssue({
            audio: recording.audio,
            context: {
              durationMs: recording.audio.durationMs,
              mimeType: recording.audio.mimeType,
              modelName: context.modelName ?? 'unknown',
              payloadSizeBytes: recording.audio.bytes.byteLength,
              speechProviderId: speechProvider.id,
            },
            error,
            kind: reason === 'provider' ? 'provider' : 'internal',
            operationId,
            source: 'provider.speech-processing',
          });
          await this.present(() =>
            this.#dependencies.presenter.showError(
              reason,
              reason === 'provider' ? errorDetail(error) : undefined,
            ),
          );
          throw error;
        }
      }

      let finalResult = result;
      let confirmationMs: number | undefined;
      if (result.intent !== 'transcription' && result.rawTranscript) {
        const confirmationStartedAt = Date.now();
        try {
          const useProcessed =
            await this.#dependencies.presenter.showConfirm(result);
          confirmationMs = elapsedSince(confirmationStartedAt);
          if (!useProcessed) {
            const retryStartedAt = Date.now();
            try {
              const polishedTextResult = textProvider
                ? await textProvider.processTranscript(result.rawTranscript, {
                    defaultTargetLanguage:
                      context.options.defaultTargetLanguage,
                    dictionary: context.options.dictionary,
                    forcedIntent: 'transcription',
                    locale: context.options.language,
                    signal: processingSignal,
                  })
                : undefined;
              const retryDurationMs = elapsedSince(retryStartedAt);
              modelProcessingMs += retryDurationMs;
              const retryCall: TextGenerationCallTrace | undefined =
                textProvider
                  ? {
                      durationMs: retryDurationMs,
                      input: {
                        defaultTargetLanguage:
                          context.options.defaultTargetLanguage,
                        dictionaryLearningEnabled: false,
                        dictionaryTermCount: context.options.dictionary.length,
                        forcedIntent: 'transcription',
                        locale: context.options.language,
                        text: result.rawTranscript,
                      },
                      kind: 'text-generation',
                      outputText: polishedTextResult?.outputText,
                      providerId: textProvider.id,
                      status: 'success',
                    }
                  : undefined;

              finalResult = {
                ...(result.dictionaryCandidates
                  ? { dictionaryCandidates: result.dictionaryCandidates }
                  : {}),
                intent: 'transcription',
                modelCalls: [
                  ...(result.modelCalls ?? []),
                  ...(retryCall ? [retryCall] : []),
                ],
                outputText:
                  polishedTextResult?.outputText ?? result.rawTranscript,
                rawTranscript: result.rawTranscript,
                usage: result.usage,
              };
            } catch (error) {
              const retryDurationMs = elapsedSince(retryStartedAt);
              if (textProvider) modelProcessingMs += retryDurationMs;
              console.error(
                'Polish failed when user rejected processed text',
                error,
              );
              const retryCall: TextGenerationCallTrace | undefined =
                textProvider
                  ? {
                      durationMs: retryDurationMs,
                      error: errorDetail(error) ?? 'Text processing failed',
                      input: {
                        defaultTargetLanguage:
                          context.options.defaultTargetLanguage,
                        dictionaryLearningEnabled: false,
                        dictionaryTermCount: context.options.dictionary.length,
                        forcedIntent: 'transcription',
                        locale: context.options.language,
                        text: result.rawTranscript,
                      },
                      kind: 'text-generation',
                      providerId: textProvider.id,
                      status: 'failed',
                    }
                  : undefined;
              finalResult = {
                ...(result.dictionaryCandidates
                  ? { dictionaryCandidates: result.dictionaryCandidates }
                  : {}),
                intent: 'transcription',
                modelCalls: [
                  ...(result.modelCalls ?? []),
                  ...(retryCall ? [retryCall] : []),
                ],
                outputText: result.rawTranscript,
                rawTranscript: result.rawTranscript,
                usage: result.usage,
              };
            }
          }
        } catch (error) {
          console.error('Dictation confirmation failed', error);
        } finally {
          confirmationMs ??= elapsedSince(confirmationStartedAt);
        }
      }

      let injected = false;
      const injectionStartedAt = Date.now();
      try {
        injected = (
          await this.#dependencies.injection.inject(
            finalResult.outputText,
            target,
          )
        ).injected;
      } catch (error) {
        console.error('Dictation injection failed', error);
        this.recordIssue({
          error,
          kind: 'internal',
          operationId,
          source: 'dictation.injection',
        });
      }
      const injectionMs = elapsedSince(injectionStartedAt);

      try {
        this.#dependencies.history.record(
          {
            audioDurationMs: recording.audio.durationMs,
            intent: finalResult.intent,
            language: context.uiLanguage,
            ...(context.modelName ? { modelName: context.modelName } : {}),
            outputText: finalResult.outputText,
            processingTrace: {
              ...(confirmationMs === undefined ? {} : { confirmationMs }),
              injectionMs,
              modelCalls: enrichModelCalls(finalResult.modelCalls, context),
              modelProcessingMs,
              operationId,
              recorderFinalizationMs,
              totalDurationMs: elapsedSince(processingStartedAt),
            },
            providerId: speechProvider.id,
            rawTranscript: finalResult.rawTranscript,
          },
          context.history,
        );
      } catch (error) {
        console.error('Dictation history write failed', error);
        this.recordIssue({
          error,
          kind: 'internal',
          operationId,
          source: 'storage.history',
        });
      }

      const successPresentationGeneration = await this.present(() =>
        this.#dependencies.presenter.showSuccess(
          finalResult,
          injected ? 'inserted' : 'copy',
        ),
      );
      if (
        successPresentationGeneration !== undefined &&
        finalResult.dictionaryCandidates?.length
      ) {
        try {
          this.#dependencies.dictionaryLearning?.handleCandidates(
            finalResult.dictionaryCandidates,
            successPresentationGeneration,
          );
        } catch (error) {
          console.error('Dictionary learning dispatch failed', error);
        }
      }
      this.log({
        context: {
          delivery: injected ? 'inserted' : 'copy',
          intent: result.intent,
          outputCharacterCount: result.outputText.length,
        },
        message: 'Dictation completed successfully',
        operationId,
        scope: 'dictation.lifecycle',
      });
    } finally {
      this.#context = undefined;
      this.#operationId = undefined;
      this.#target = undefined;
      this.#state = 'idle';
    }
  }

  private async present<T>(
    action: () => T | Promise<T>,
  ): Promise<T | undefined> {
    try {
      return await action();
    } catch (error) {
      console.error('Dictation status presentation failed', error);
      this.recordIssue({
        error,
        kind: 'internal',
        source: 'dictation.presentation',
      });
      return undefined;
    }
  }

  private log(input: DiagnosticLogInput): void {
    this.#dependencies.diagnostics?.log({
      ...input,
      ...(input.operationId || !this.#operationId
        ? {}
        : { operationId: this.#operationId }),
    });
  }

  private recordIssue(input: DiagnosticIssueInput): void {
    this.#dependencies.diagnostics?.recordIssue({
      ...input,
      ...(input.operationId || !this.#operationId
        ? {}
        : { operationId: this.#operationId }),
    });
  }
}
