import {
  Menu,
  Tray,
  app,
  dialog,
  nativeImage,
  type MenuItemConstructorOptions,
} from 'electron';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AliyunBailianSpeechProvider } from '../../core/providers/aliyun-bailian-speech-provider.js';
import { AnthropicTextProvider } from '../../core/providers/anthropic-text-provider.js';
import {
  ProviderContractError,
  type AudioPayload,
  type SpeechRecognitionProvider,
  type TextGenerationProvider,
  type UserProfileContext,
} from '../../core/providers/contracts.js';
import { OpenAICompatibleSpeechProvider } from '../../core/providers/openai-compatible-speech-provider.js';
import {
  OpenAICompatibleTextProvider,
  type OpenAICompatibleTextProviderConfiguration,
} from '../../core/providers/openai-compatible-text-provider.js';
import { OpenAIResponsesTextProvider } from '../../core/providers/openai-responses-text-provider.js';
import {
  SpeechProviderRegistry,
  TextProviderRegistry,
} from '../../core/providers/registry.js';
import type {
  ClientDiagnosticExportRequest,
  ClientDiagnosticExportResult,
  ClientDiagnosticSnapshot,
  ClientRendererIssueInput,
} from '../../shared/diagnostics.js';
import type {
  ClientHistoryQuery,
  ClientHistoryRecord,
  ClientMicrophoneDevice,
  ClientProviderInput,
  ClientSettingsUpdate,
  ClientSnapshot,
  ClientUpdateSnapshot,
  ClientUsageStats,
} from '../../shared/ipc.js';
import type { DictionaryCandidate } from '../../shared/dictionary.js';
import type { DictionarySuggestionError } from '../../shared/capsule-ipc.js';
import { CapsuleWindowController } from '../capsule/capsule-window.js';
import type { DiagnosticCollector } from '../diagnostics/collector.js';
import { ClipboardInjectionService } from '../dictation/clipboard.js';
import { DictationCoordinator } from '../dictation/coordinator.js';
import { DictionaryLearningService } from '../dictionary/learning.js';
import { ElectronClipboardAdapter } from '../dictation/electron-clipboard.js';
import {
  NativeHelperClient,
  isNativeHotkeyConflictError,
} from '../native/client.js';
import { parseHotkeyAccelerator } from '../native/hotkey.js';
import { NativeHotkeyAction } from '../native/protocol.js';
import { RecorderWindowController } from '../recording/recorder-window.js';
import {
  ConfigurationService,
  DictionaryEntryError,
} from '../storage/configuration.js';
import type { ProviderProfile } from '../storage/configuration.js';
import { ElectronSecretProtector } from '../storage/electron-secret-protector.js';
import { HistoryRepository, HistoryService } from '../storage/history.js';
import { ApplicationUpdateService } from '../update/application-update-service.js';

export interface DesktopRuntimeOptions {
  applicationIconPath: string;
  diagnostics: DiagnosticCollector;
  onSnapshotChanged: (snapshot: ClientSnapshot) => void;
  onUpdateChanged: (snapshot: ClientUpdateSnapshot) => void;
  showMainWindow: () => void | Promise<void>;
}

const isString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const toProviderConfiguration = (
  profile: ProviderProfile,
): OpenAICompatibleTextProviderConfiguration | undefined => {
  const apiKey = profile.secrets.apiKey;
  if (!isString(apiKey)) {
    return undefined;
  }
  return {
    apiKey,
    baseUrl: profile.values.baseUrl,
    displayName: profile.values.name,
    id: profile.id,
    model: profile.values.model,
    ...(typeof profile.values.allowInsecurePrivateEndpoint === 'boolean'
      ? {
          allowInsecurePrivateEndpoint:
            profile.values.allowInsecurePrivateEndpoint,
        }
      : {}),
  };
};

const createTextProvider = (
  profile: ProviderProfile,
  fetchImplementation: typeof fetch = fetch,
): TextGenerationProvider => {
  if (profile.kind !== 'text') {
    throw new Error('Text provider profile has the wrong kind');
  }
  const configuration = toProviderConfiguration(profile);
  if (!configuration) throw new Error('Provider profile is incomplete');
  if (profile.providerId === 'openai-compatible-text') {
    return new OpenAICompatibleTextProvider(configuration, fetchImplementation);
  }
  if (profile.providerId === 'openai-responses-text') {
    return new OpenAIResponsesTextProvider(configuration, fetchImplementation);
  }
  if (profile.providerId === 'anthropic-text') {
    return new AnthropicTextProvider(configuration, fetchImplementation);
  }
  throw new Error('Text provider profile has an unsupported provider id');
};

const createSpeechProvider = (
  profile: ProviderProfile,
  fetchImplementation: typeof fetch = fetch,
): SpeechRecognitionProvider => {
  if (profile.kind !== 'speech') {
    throw new Error('Speech provider profile has the wrong kind');
  }
  const configuration = toProviderConfiguration(profile);
  if (!configuration) throw new Error('Provider profile is incomplete');
  if (profile.providerId === 'openai-compatible-speech') {
    return new OpenAICompatibleSpeechProvider(
      configuration,
      fetchImplementation,
    );
  }
  if (profile.providerId === 'aliyun-bailian-speech') {
    return new AliyunBailianSpeechProvider(configuration, fetchImplementation);
  }
  throw new Error('Speech provider profile has an unsupported provider id');
};

const createConnectionTestWav = (): AudioPayload => {
  const channels = 1;
  const durationMs = 1_000;
  const sampleRateHz = 16_000;
  const bytesPerSample = 2;
  const sampleCount = Math.floor((sampleRateHz * durationMs) / 1_000);
  const audioByteLength = sampleCount * channels * bytesPerSample;
  const wav = Buffer.alloc(44 + audioByteLength);
  wav.write('RIFF', 0, 'ascii');
  wav.writeUInt32LE(36 + audioByteLength, 4);
  wav.write('WAVE', 8, 'ascii');
  wav.write('fmt ', 12, 'ascii');
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(channels, 22);
  wav.writeUInt32LE(sampleRateHz, 24);
  wav.writeUInt32LE(sampleRateHz * channels * bytesPerSample, 28);
  wav.writeUInt16LE(channels * bytesPerSample, 32);
  wav.writeUInt16LE(bytesPerSample * 8, 34);
  wav.write('data', 36, 'ascii');
  wav.writeUInt32LE(audioByteLength, 40);
  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    const sample = Math.round(
      Math.sin((2 * Math.PI * 440 * sampleIndex) / sampleRateHz) * 0x1800,
    );
    wav.writeInt16LE(sample, 44 + sampleIndex * bytesPerSample);
  }
  return {
    bytes: new Uint8Array(wav),
    channels,
    durationMs,
    mimeType: 'audio/wav',
    sampleRateHz,
  };
};

const resolveNativeHelperPath = (): string =>
  app.isPackaged
    ? path.join(process.resourcesPath, 'bin', 'untypo_native_helper.exe')
    : path.resolve(app.getAppPath(), 'build/Release/untypo_native_helper.exe');

export class DesktopRuntime {
  readonly #capsule = new CapsuleWindowController();
  readonly #configuration: ConfigurationService;
  readonly #dictionaryLearning: DictionaryLearningService;
  readonly #diagnostics: DiagnosticCollector;
  readonly #historyRepository: HistoryRepository;
  readonly #history: HistoryService;
  readonly #native = new NativeHelperClient(resolveNativeHelperPath());
  readonly #options: DesktopRuntimeOptions;
  readonly #recorder = new RecorderWindowController(undefined, (level) =>
    this.#capsule.updateLevel(level),
  );
  readonly #speechProviders = new SpeechProviderRegistry();
  readonly #textProviders = new TextProviderRegistry();
  readonly #updates: ApplicationUpdateService;
  #coordinator?: DictationCoordinator;
  #hotkeyQueue: Promise<void> = Promise.resolve();
  #locale: 'en-US' | 'zh-CN' = 'en-US';
  #removeHotkeyListener?: () => void;
  #speechProviderId?: string;
  #started = false;
  #textProviderId?: string;
  #tray?: Tray;

  constructor(options: DesktopRuntimeOptions) {
    this.#options = options;
    this.#diagnostics = options.diagnostics;
    const userDataPath = app.getPath('userData');
    this.#configuration = new ConfigurationService(
      path.join(userDataPath, 'config.json'),
      new ElectronSecretProtector(),
    );
    this.#dictionaryLearning = new DictionaryLearningService(
      this.#configuration,
    );
    this.#historyRepository = new HistoryRepository(
      path.join(userDataPath, 'history.sqlite3'),
    );
    this.#history = new HistoryService(this.#historyRepository);
    this.#updates = new ApplicationUpdateService({
      diagnostics: this.#diagnostics,
      onChanged: options.onUpdateChanged,
    });
  }

  async start(): Promise<void> {
    if (this.#started) throw new Error('Desktop runtime is already active');
    this.#diagnostics.log({
      message: 'Desktop runtime startup requested',
      scope: 'app.runtime',
    });
    const config = await this.#configuration.load();
    await this.activateConfiguredProviders(config);
    this.#coordinator = new DictationCoordinator({
      diagnostics: this.#diagnostics,
      dictionaryLearning: {
        handleCandidates: (candidates, successPresentationGeneration) =>
          this.handleDictionaryCandidates(
            candidates,
            successPresentationGeneration,
          ),
      },
      getContext: async () => {
        const current = await this.#configuration.load();
        const speechProviderId = this.#speechProviderId;
        if (!speechProviderId) {
          throw new Error('No speech recognition model is configured');
        }
        const activeSpeechProfile = current.providers.find(
          ({ id, kind }) => id === speechProviderId && kind === 'speech',
        );
        const activeTextProfile = current.providers.find(
          ({ id, kind }) => id === this.#textProviderId && kind === 'text',
        );
        return {
          history: current.history,
          ...(current.dictation.fastMode !== undefined
            ? { fastMode: current.dictation.fastMode }
            : {}),
          modelName: activeSpeechProfile?.values.model ?? speechProviderId,
          ...(current.dictation.microphoneDeviceId
            ? { microphoneDeviceId: current.dictation.microphoneDeviceId }
            : {}),
          options: {
            defaultTargetLanguage: current.dictation.defaultTargetLanguage,
            dictionary: current.dictionary.map(({ term }) => term),
            dictionaryLearningEnabled:
              current.dictionaryLearning.enabled &&
              this.#textProviderId !== undefined,
            ...(current.dictation.fastMode !== undefined
              ? { fastMode: current.dictation.fastMode }
              : {}),
            language: current.dictation.language,
            preferIntegratedProcess: false,
            profile: await this.#configuration.getProfile(),
          },
          speechProviderId,
          ...(activeSpeechProfile
            ? {
                speechProviderDetails: {
                  modelName: activeSpeechProfile.values.model,
                  providerName: activeSpeechProfile.values.name,
                  providerType: activeSpeechProfile.providerId,
                },
              }
            : {}),
          ...(this.#textProviderId
            ? { textProviderId: this.#textProviderId }
            : {}),
          ...(activeTextProfile
            ? {
                textProviderDetails: {
                  modelName: activeTextProfile.values.model,
                  providerName: activeTextProfile.values.name,
                  providerType: activeTextProfile.providerId,
                },
              }
            : {}),
          uiLanguage: current.general.locale,
        };
      },
      history: this.#history,
      injection: new ClipboardInjectionService(
        new ElectronClipboardAdapter(),
        this.#native,
      ),
      native: this.#native,
      presenter: {
        showConfirm: (result) =>
          this.#capsule.showConfirm(result, this.#locale),
        showError: (reason, detail) =>
          this.#capsule.showError(reason, this.#locale, detail),
        showProcessing: () => this.#capsule.showProcessing(this.#locale),
        showRecording: () => this.#capsule.showRecording(this.#locale),
        showSuccess: (result, delivery) =>
          this.#capsule.showSuccess(result, delivery, this.#locale),
        updateProcessing: (outputText) =>
          this.#capsule.updateProcessing(outputText),
      },
      recorder: this.#recorder,
      speechProviders: this.#speechProviders,
      textProviders: this.#textProviders,
    });

    try {
      await this.#recorder.initialize();
      await this.#native.start();
      const nativeHotkey = parseHotkeyAccelerator(
        config.dictation.hotkeyAccelerator,
      );
      try {
        await this.#native.configureHotkey(nativeHotkey);
        this.logHotkeyConfiguration(
          config.dictation.hotkeyAccelerator,
          nativeHotkey,
        );
      } catch (error) {
        if (!isNativeHotkeyConflictError(error)) throw error;
        this.#diagnostics.recordIssue({
          context: { accelerator: config.dictation.hotkeyAccelerator },
          error,
          kind: 'configuration',
          source: 'hotkey.configuration',
        });
      }
      this.#removeHotkeyListener = this.#native.onHotkey((action) => {
        this.#diagnostics.log({
          context: { action: 'toggle' },
          message: 'Native hotkey event received',
          scope: 'hotkey.event',
        });
        if (process.env.UNTYPO_HOTKEY_PROBE === '1') return;
        this.dispatchHotkey(action);
      });
      app.setLoginItemSettings({ openAtLogin: config.general.launchAtLogin });
      this.createTray(config.general.locale);
      this.#updates.start(config.updates);
      this.#started = true;
      this.#diagnostics.log({
        context: {
          fastModeEnabled: config.dictation.fastMode === true,
          speechProviderConfigured: this.#speechProviderId !== undefined,
          textProviderConfigured: this.#textProviderId !== undefined,
        },
        message: 'Desktop runtime started',
        scope: 'app.runtime',
      });
    } catch (error) {
      this.#diagnostics.recordIssue({
        error,
        kind: 'internal',
        source: 'app.runtime.startup',
      });
      await this.#native.stop();
      this.#recorder.destroy();
      this.#capsule.destroy();
      this.#historyRepository.close();
      throw error;
    }
  }

  async smokeTest(): Promise<boolean> {
    const [recorderReady, , dictionaryCapsuleReady] = await Promise.all([
      this.#recorder.smokeTest(),
      this.#native.ping(),
      this.#capsule.smokeTestDictionarySuggestion(),
    ]);
    return recorderReady && dictionaryCapsuleReady;
  }

  async getClientSnapshot(): Promise<ClientSnapshot> {
    const [config, profile] = await Promise.all([
      this.#configuration.load(),
      this.#configuration.getProfile(),
    ]);
    return {
      dictionary: config.dictionary,
      dictionaryLearning: { enabled: config.dictionaryLearning.enabled },
      ...(profile ? { profile } : {}),
      providers: config.providers.map((provider) => ({
        configuredSecretKeys: Object.keys(provider.secrets),
        id: provider.id,
        kind: provider.kind,
        providerId: provider.providerId,
        values: structuredClone(provider.values),
      })),
      settings: {
        dictation: {
          ...(config.dictation.activeSpeechProviderProfileId
            ? {
                activeSpeechProviderProfileId:
                  config.dictation.activeSpeechProviderProfileId,
              }
            : {}),
          ...(config.dictation.activeTextProviderProfileId
            ? {
                activeTextProviderProfileId:
                  config.dictation.activeTextProviderProfileId,
              }
            : {}),
          defaultTargetLanguage: config.dictation.defaultTargetLanguage,
          ...(config.dictation.fastMode !== undefined
            ? { fastMode: config.dictation.fastMode }
            : {}),
          hotkeyAccelerator: config.dictation.hotkeyAccelerator,
          language: config.dictation.language,
          ...(config.dictation.microphoneDeviceId
            ? { microphoneDeviceId: config.dictation.microphoneDeviceId }
            : {}),
        },
        general: config.general,
        history: config.history,
        updates: config.updates,
      },
      update: this.#updates.snapshot(),
    };
  }

  async updateSettings(update: ClientSettingsUpdate): Promise<ClientSnapshot> {
    const current = await this.#configuration.load();
    const requestedSpeechProfile =
      update.dictation?.activeSpeechProviderProfileId;
    if (
      typeof requestedSpeechProfile === 'string' &&
      !current.providers.some(
        ({ id, kind }) => id === requestedSpeechProfile && kind === 'speech',
      )
    ) {
      throw new Error('Active speech provider profile does not exist');
    }
    const requestedTextProfile = update.dictation?.activeTextProviderProfileId;
    if (
      typeof requestedTextProfile === 'string' &&
      !current.providers.some(
        ({ id, kind }) => id === requestedTextProfile && kind === 'text',
      )
    ) {
      throw new Error('Active text provider profile does not exist');
    }
    const requestedHotkey = update.dictation?.hotkeyAccelerator;
    const nextHotkey = parseHotkeyAccelerator(
      requestedHotkey ?? current.dictation.hotkeyAccelerator,
    );
    const hotkeyChanged =
      requestedHotkey !== undefined &&
      requestedHotkey !== current.dictation.hotkeyAccelerator;

    if (hotkeyChanged) {
      try {
        await this.#native.configureHotkey(nextHotkey);
      } catch (error) {
        this.#diagnostics.recordIssue({
          context: { accelerator: requestedHotkey },
          error,
          kind: 'configuration',
          source: 'hotkey.configuration',
        });
        if (isNativeHotkeyConflictError(error)) {
          throw new Error('HOTKEY_CONFLICT', { cause: error });
        }
        throw new Error('HOTKEY_UNAVAILABLE', { cause: error });
      }
    }

    let next: Awaited<ReturnType<ConfigurationService['update']>>;
    try {
      next = await this.#configuration.update((config) => {
        const {
          activeSpeechProviderProfileId,
          activeTextProviderProfileId,
          microphoneDeviceId,
          ...dictationUpdate
        } = update.dictation ?? {};
        const dictation = { ...config.dictation, ...dictationUpdate };
        if (activeSpeechProviderProfileId === null) {
          delete dictation.activeSpeechProviderProfileId;
        } else if (activeSpeechProviderProfileId !== undefined) {
          dictation.activeSpeechProviderProfileId =
            activeSpeechProviderProfileId;
        }
        if (activeTextProviderProfileId === null) {
          delete dictation.activeTextProviderProfileId;
        } else if (activeTextProviderProfileId !== undefined) {
          dictation.activeTextProviderProfileId = activeTextProviderProfileId;
        }
        if (microphoneDeviceId === null) {
          delete dictation.microphoneDeviceId;
        } else if (microphoneDeviceId !== undefined) {
          dictation.microphoneDeviceId = microphoneDeviceId;
        }
        return {
          ...config,
          dictation,
          general: { ...config.general, ...update.general },
          history: { ...config.history, ...update.history },
          updates: { ...config.updates, ...update.updates },
        };
      });
    } catch (error) {
      if (hotkeyChanged) {
        try {
          const previousHotkey = parseHotkeyAccelerator(
            current.dictation.hotkeyAccelerator,
          );
          await this.#native.configureHotkey(previousHotkey);
        } catch (rollbackError) {
          this.#diagnostics.recordIssue({
            error: rollbackError,
            kind: 'internal',
            source: 'hotkey.rollback',
          });
        }
      }
      throw error;
    }
    if (hotkeyChanged) {
      this.logHotkeyConfiguration(next.dictation.hotkeyAccelerator, nextHotkey);
    }
    app.setLoginItemSettings({ openAtLogin: next.general.launchAtLogin });
    this.applyLocale(next.general.locale);
    this.#updates.configure(next.updates);
    await this.activateConfiguredProviders(next);
    this.#diagnostics.log({
      context: {
        changedGroups: Object.keys(update),
        dictationFields: Object.keys(update.dictation ?? {}),
        generalFields: Object.keys(update.general ?? {}),
        historyFields: Object.keys(update.history ?? {}),
        updateFields: Object.keys(update.updates ?? {}),
      },
      message: 'Application settings updated',
      scope: 'client.settings',
    });
    return this.getClientSnapshot();
  }

  async addDictionaryEntry(term: string): Promise<ClientSnapshot> {
    await this.#configuration.addDictionaryEntry(term, 'manual');
    try {
      await this.#dictionaryLearning.forgetTerm(term);
    } catch (error) {
      this.#diagnostics.recordIssue({
        error,
        kind: 'internal',
        source: 'dictionary.learning-cleanup',
      });
    }
    return this.getClientSnapshot();
  }

  async removeDictionaryEntry(term: string): Promise<ClientSnapshot> {
    await this.#configuration.removeDictionaryEntry(term);
    return this.getClientSnapshot();
  }

  async setDictionaryLearningEnabled(
    enabled: boolean,
  ): Promise<ClientSnapshot> {
    await this.#configuration.setDictionaryLearningEnabled(enabled);
    return this.getClientSnapshot();
  }

  async listMicrophones(): Promise<readonly ClientMicrophoneDevice[]> {
    try {
      const devices = await this.#recorder.listDevices();
      this.#diagnostics.log({
        context: { deviceCount: devices.length },
        message: 'Microphone discovery completed',
        scope: 'recorder.devices',
      });
      return devices;
    } catch (error) {
      this.#diagnostics.recordIssue({
        error,
        kind: 'microphone',
        source: 'recorder.devices',
      });
      throw error;
    }
  }

  async setProfile(profile?: UserProfileContext): Promise<ClientSnapshot> {
    await this.#configuration.setProfile(profile);
    return this.getClientSnapshot();
  }

  async upsertProvider(profile: ClientProviderInput): Promise<ClientSnapshot> {
    const existing = await this.#configuration.getProvider(profile.id);
    if (existing && existing.kind !== profile.kind) {
      throw new Error('A provider profile cannot change kind');
    }
    const candidate: ProviderProfile = {
      ...profile,
      secrets: profile.secrets.apiKey
        ? { apiKey: profile.secrets.apiKey }
        : (existing?.secrets ?? {}),
    };
    if (candidate.kind === 'speech') createSpeechProvider(candidate);
    else createTextProvider(candidate);

    const current = await this.#configuration.upsertProvider(profile);
    let next = current;
    if (
      profile.kind === 'speech' &&
      !current.dictation.activeSpeechProviderProfileId
    ) {
      next = await this.#configuration.update((config) => ({
        ...config,
        dictation: {
          ...config.dictation,
          activeSpeechProviderProfileId: profile.id,
        },
      }));
    } else if (
      profile.kind === 'text' &&
      !current.dictation.activeTextProviderProfileId
    ) {
      next = await this.#configuration.update((config) => ({
        ...config,
        dictation: {
          ...config.dictation,
          activeTextProviderProfileId: profile.id,
        },
      }));
    }
    await this.activateConfiguredProviders(next);
    this.#diagnostics.log({
      context: {
        kind: profile.kind,
        profileId: profile.id,
        providerId: profile.providerId,
      },
      message: 'Provider configuration saved',
      scope: 'client.providers',
    });
    return this.getClientSnapshot();
  }

  async removeProvider(profileId: string): Promise<ClientSnapshot> {
    const next = await this.#configuration.removeProvider(profileId);
    await this.activateConfiguredProviders(next);
    this.#diagnostics.log({
      context: { profileId },
      message: 'Provider configuration removed',
      scope: 'client.providers',
    });
    return this.getClientSnapshot();
  }

  async testProvider(profileId: string): Promise<{ ok: true }> {
    const profile = await this.#configuration.getProvider(profileId);
    if (!profile) throw new Error('Provider profile does not exist');
    try {
      if (profile.kind === 'text') {
        const provider = createTextProvider(
          profile,
          this.providerFetch(profile),
        );
        await provider.processTranscript('Transcribe this connection test.', {
          defaultTargetLanguage: 'en-US',
          dictionary: [],
          forcedIntent: 'transcription',
          locale: 'en-US',
        });
      } else {
        const provider = createSpeechProvider(
          profile,
          this.providerFetch(profile),
        );
        if (provider instanceof AliyunBailianSpeechProvider) {
          await provider.testConnection();
        } else {
          await provider.transcribe(createConnectionTestWav(), {
            dictionary: [],
            language: 'en-US',
          });
        }
      }
    } catch (error) {
      if (
        error instanceof ProviderContractError &&
        error.code === 'EMPTY_RESULT'
      ) {
        return { ok: true };
      }
      this.#diagnostics.recordIssue({
        context: {
          profileId: profile.id,
          providerId: profile.providerId,
          testConnection: true,
        },
        error,
        kind: 'provider',
        source: 'provider.connection-test',
      });
      throw error;
    }
    return { ok: true };
  }

  acknowledgeDiagnostics(
    issueIds: readonly string[],
  ): ClientDiagnosticSnapshot {
    return this.#diagnostics.acknowledge(issueIds);
  }

  async exportDiagnostics(
    request: ClientDiagnosticExportRequest,
  ): Promise<ClientDiagnosticExportResult> {
    const timestamp = new Date().toISOString().replace(/[:.]/gu, '-');
    const result = await dialog.showSaveDialog({
      defaultPath: `UnTypo-diagnostics-${timestamp}.zip`,
      filters: [{ extensions: ['zip'], name: 'UnTypo diagnostic package' }],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
      title: 'Export UnTypo diagnostic package',
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    await writeFile(result.filePath, this.#diagnostics.buildArchive(request));
    return { canceled: false, filePath: result.filePath };
  }

  getDiagnostics(): ClientDiagnosticSnapshot {
    return this.#diagnostics.snapshot();
  }

  onDiagnosticsChanged(listener: () => void): () => void {
    return this.#diagnostics.onChanged(listener);
  }

  reportRendererIssue(issue: ClientRendererIssueInput): void {
    this.#diagnostics.recordRendererIssue(issue);
  }

  listHistory(query: ClientHistoryQuery): readonly ClientHistoryRecord[] {
    return this.#historyRepository.list(query.limit, query.offset);
  }

  getUsageStats(): ClientUsageStats {
    return this.#historyRepository.getUsageStats();
  }

  clearHistory(): number {
    return this.#historyRepository.clear();
  }

  checkForUpdates(): Promise<ClientUpdateSnapshot> {
    return this.#updates.checkForUpdates();
  }

  downloadUpdate(): Promise<ClientUpdateSnapshot> {
    return this.#updates.downloadUpdate();
  }

  isUpdateReady(): boolean {
    return this.#updates.isReadyToInstall();
  }

  quitAndInstallUpdate(): void {
    this.#updates.quitAndInstall();
  }

  installUpdate(): void {
    if (!this.#updates.isReadyToInstall()) return;
    app.quit();
  }

  async stop(): Promise<void> {
    if (!this.#started) return;
    this.#started = false;
    this.#removeHotkeyListener?.();
    this.#removeHotkeyListener = undefined;
    this.#tray?.destroy();
    this.#tray = undefined;
    this.#updates.stop();
    this.#capsule.destroy();
    this.#recorder.destroy();
    await this.#native.stop();
    this.#historyRepository.close();
    this.#diagnostics.log({
      message: 'Desktop runtime stopped',
      scope: 'app.runtime',
    });
  }

  private async activateConfiguredProviders(
    config: Awaited<ReturnType<ConfigurationService['load']>>,
  ): Promise<void> {
    this.#speechProviders.clear();
    this.#textProviders.clear();
    this.#speechProviderId = undefined;
    this.#textProviderId = undefined;

    const speechProfileId = config.dictation.activeSpeechProviderProfileId;
    if (speechProfileId) {
      const profile = await this.#configuration.getProvider(speechProfileId);
      if (!profile) {
        throw new Error('Active speech provider profile does not exist');
      }
      const provider = createSpeechProvider(
        profile,
        this.providerFetch(profile),
      );
      this.#speechProviders.replace(provider);
      this.#speechProviderId = provider.id;
    }

    const textProfileId = config.dictation.activeTextProviderProfileId;
    if (textProfileId) {
      const profile = await this.#configuration.getProvider(textProfileId);
      if (!profile) {
        throw new Error('Active text provider profile does not exist');
      }
      const provider = createTextProvider(profile, this.providerFetch(profile));
      this.#textProviders.replace(provider);
      this.#textProviderId = provider.id;
    }
  }

  private handleDictionaryCandidates(
    candidates: readonly DictionaryCandidate[],
    successPresentationGeneration: number,
  ): void {
    void (async () => {
      const candidate = await this.#dictionaryLearning.observe(candidates);
      if (!candidate) return;
      const decision = await this.#capsule.showDictionarySuggestion(
        candidate.term,
        this.#locale,
        successPresentationGeneration,
        async (acceptedTerm) => {
          try {
            await this.#dictionaryLearning.accept(candidate.term, acceptedTerm);
            this.#options.onSnapshotChanged(await this.getClientSnapshot());
            this.#diagnostics.log({
              context: { source: 'learned' },
              message: 'Dictionary suggestion accepted',
              scope: 'dictionary.learning',
            });
            return undefined;
          } catch (error) {
            if (error instanceof DictionaryEntryError) {
              const errors: Record<
                DictionaryEntryError['code'],
                DictionarySuggestionError
              > = {
                DICTIONARY_DUPLICATE: 'duplicate',
                DICTIONARY_EMPTY: 'empty',
                DICTIONARY_FULL: 'full',
                DICTIONARY_TOO_LONG: 'too-long',
              };
              return errors[error.code];
            }
            throw error;
          }
        },
      );
      if (decision === 'rejected') {
        await this.#dictionaryLearning.reject(candidate.term);
        this.#diagnostics.log({
          context: { cooldownDays: 30 },
          message: 'Dictionary suggestion rejected',
          scope: 'dictionary.learning',
        });
      }
    })().catch((error: unknown) => {
      this.#diagnostics.recordIssue({
        error,
        kind: 'internal',
        source: 'dictionary.learning',
      });
    });
  }

  private dispatchHotkey(action: NativeHotkeyAction): void {
    this.#hotkeyQueue = this.#hotkeyQueue
      .then(async () => {
        await this.#coordinator?.handleHotkey(action);
        this.refreshTrayMenu();
      })
      .catch((error: unknown) => {
        console.error('Dictation operation failed', error);
        this.#diagnostics.log({
          context: { error },
          level: 'warning',
          message: 'Dictation operation returned an error',
          scope: 'dictation.dispatch',
        });
        this.refreshTrayMenu();
      });
  }

  private logHotkeyConfiguration(
    accelerator: string,
    configuration: ReturnType<typeof parseHotkeyAccelerator>,
  ): void {
    this.#diagnostics.log({
      context: {
        accelerator,
        modifiers: configuration.modifiers,
        virtualKey: configuration.virtualKey,
      },
      message: 'Native hotkey configured',
      scope: 'hotkey.configuration',
    });
  }

  private providerFetch(profile: ProviderProfile): typeof fetch {
    return this.#diagnostics.createLoggedFetch({
      model: profile.values.model,
      profileId: profile.id,
      providerId: profile.providerId,
    });
  }

  private createTray(locale: 'en-US' | 'zh-CN'): void {
    const icon = nativeImage
      .createFromPath(this.#options.applicationIconPath)
      .resize({
        height: 16,
        width: 16,
      });
    if (icon.isEmpty()) {
      throw new Error(
        `Application tray icon could not be loaded: ${this.#options.applicationIconPath}`,
      );
    }
    this.#tray = new Tray(icon);
    this.#tray.on('click', () => void this.#options.showMainWindow());
    this.applyLocale(locale);
  }

  private applyLocale(locale: 'en-US' | 'zh-CN'): void {
    this.#locale = locale;
    this.#tray?.setToolTip(
      locale === 'zh-CN' ? 'UnTypo 听写' : 'UnTypo Dictation',
    );
    this.refreshTrayMenu(locale);
  }

  private refreshTrayMenu(locale = this.#locale): void {
    if (!this.#tray) return;
    const isRecording = this.#coordinator?.state === 'recording';
    const template: MenuItemConstructorOptions[] = [
      {
        click: () => this.dispatchHotkey(NativeHotkeyAction.Toggle),
        label:
          locale === 'zh-CN'
            ? isRecording
              ? '停止听写'
              : '开始听写'
            : isRecording
              ? 'Stop dictation'
              : 'Start dictation',
      },
      {
        click: () => void this.#options.showMainWindow(),
        label: locale === 'zh-CN' ? '打开设置' : 'Open settings',
      },
      { type: 'separator' },
      {
        click: () => app.quit(),
        label: locale === 'zh-CN' ? '退出' : 'Quit',
      },
    ];
    this.#tray.setContextMenu(Menu.buildFromTemplate(template));
  }
}
