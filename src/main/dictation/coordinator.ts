import { DictationPipeline } from '../../core/providers/pipeline.js';
import type {
  ProcessOptions,
  ProcessResult,
  SupportedLanguage,
} from '../../core/providers/contracts.js';
import type {
  SpeechProviderRegistry,
  TextProviderRegistry,
} from '../../core/providers/registry.js';
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

export type DictationRuntimeState = 'idle' | 'recording' | 'processing';

export interface RecorderPort {
  start: (target: TargetSnapshot) => Promise<string>;
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

export interface FallbackPresenter {
  show: (result: ProcessResult) => void | Promise<void>;
}

export interface HistoryPort {
  record: (input: NewHistoryRecord, policy: HistoryPolicy) => unknown;
}

export interface DictationContext {
  history: HistoryPolicy;
  modelName?: string;
  options: ProcessOptions;
  speechProviderId: string;
  textProviderId?: string;
  uiLanguage: SupportedLanguage;
}

export interface DictationCoordinatorDependencies {
  fallback: FallbackPresenter;
  getContext: () => DictationContext | Promise<DictationContext>;
  history: HistoryPort;
  injection: InjectionPort;
  native: NativeTargetPort;
  recorder: RecorderPort;
  speechProviders: SpeechProviderRegistry;
  textProviders: TextProviderRegistry;
}

const toRecordingTarget = (target: NativeTargetSnapshot): TargetSnapshot => ({
  processId: target.processId,
  windowHandle: target.windowHandle,
});

export class DictationCoordinator {
  readonly #dependencies: DictationCoordinatorDependencies;
  #state: DictationRuntimeState = 'idle';
  #target?: NativeTargetSnapshot;

  constructor(dependencies: DictationCoordinatorDependencies) {
    this.#dependencies = dependencies;
  }

  get state(): DictationRuntimeState {
    return this.#state;
  }

  async handleHotkey(action: NativeHotkeyAction): Promise<void> {
    if (action === HotkeyAction.Start) {
      await this.start();
    } else if (action === HotkeyAction.Stop) {
      await this.stop();
    } else if (action === HotkeyAction.Toggle) {
      if (this.#state === 'idle') await this.start();
      else if (this.#state === 'recording') await this.stop();
    }
  }

  async start(): Promise<void> {
    if (this.#state !== 'idle') return;
    const target = await this.#dependencies.native.captureTarget();
    await this.#dependencies.recorder.start(toRecordingTarget(target));
    this.#target = target;
    this.#state = 'recording';
  }

  async stop(): Promise<void> {
    if (this.#state !== 'recording' || !this.#target) return;
    this.#state = 'processing';
    const target = this.#target;
    try {
      const [recording, context] = await Promise.all([
        this.#dependencies.recorder.stop(),
        this.#dependencies.getContext(),
      ]);
      const speechProvider = this.#dependencies.speechProviders.require(
        context.speechProviderId,
      );
      const textProvider = context.textProviderId
        ? this.#dependencies.textProviders.require(context.textProviderId)
        : undefined;
      const result = await new DictationPipeline(
        speechProvider,
        textProvider,
      ).process(recording.audio, context.options);
      const injection = await this.#dependencies.injection.inject(
        result.outputText,
        target,
      );
      if (!injection.injected) await this.#dependencies.fallback.show(result);
      this.#dependencies.history.record(
        {
          audioDurationMs: recording.audio.durationMs,
          intent: result.intent,
          language: context.uiLanguage,
          ...(context.modelName ? { modelName: context.modelName } : {}),
          outputText: result.outputText,
          providerId: speechProvider.id,
          rawTranscript: result.rawTranscript,
        },
        context.history,
      );
    } finally {
      this.#target = undefined;
      this.#state = 'idle';
    }
  }
}
