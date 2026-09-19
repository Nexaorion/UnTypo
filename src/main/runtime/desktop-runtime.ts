import { app, dialog, shell, systemPreferences, type WebContents } from 'electron';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ProviderContractError, type UserProfileContext } from '../../core/providers/contracts.js';
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
import type {
  ClientSyncConfigUpdate,
  ClientSyncResult,
  ClientSyncSnapshot,
  SyncBackupInfo,
} from '../../shared/sync.js';
import { resolveMicrophoneSelection, type MicrophoneSelection } from '../../shared/microphone.js';
import type { DictionaryCandidate } from '../../shared/dictionary.js';
import type {
  ClientApplicationWritingStyleUpdate,
  TargetApplicationKind,
  WritingPreferenceCandidate,
} from '../../shared/personalization.js';
import type { DictionarySuggestionError } from '../../shared/capsule-ipc.js';
import { CapsuleWindowController } from '../capsule/capsule-window.js';
import type { DiagnosticCollector } from '../diagnostics/collector.js';
import { ClipboardInjectionService } from '../dictation/clipboard.js';
import { pasteDarwinWithHelperFallback } from '../dictation/darwin-paste.js';
import { DictationCoordinator } from '../dictation/coordinator.js';
import { buildUserProfileContext } from '../dictation/dictation-context.js';
import { DictionaryLearningService } from '../dictionary/learning.js';
import { WritingPreferenceLearningService } from '../personalization/learning.js';
import { ElectronClipboardAdapter } from '../dictation/electron-clipboard.js';
import { HotkeyManager } from '../hotkey/hotkey-manager.js';
import type { ClientBackendPort } from '../ipc/client-controller.js';
import { createLoginItemSettings } from '../login-item.js';
import {
  NativeHelperClient,
  isNativeHotkeyConflictError,
  nativeHelperFileName,
} from '../native/client.js';
import { NativeHotkeyAction } from '../native/protocol.js';
import {
  createSpeechProvider,
  createTextProvider,
  testProviderConnection,
} from '../providers/provider-factory.js';
import { ProviderActivationService } from '../providers/provider-activation.js';
import { RecorderWindowController } from '../recording/recorder-window.js';
import { ConfigurationService, DictionaryEntryError } from '../storage/configuration.js';
import type { ProviderProfile } from '../storage/configuration.js';
import { ElectronSecretProtector } from '../storage/electron-secret-protector.js';
import { HistoryRepository, HistoryService } from '../storage/history.js';
import { SyncService } from '../sync/sync-service.js';
import { ApplicationUpdateService } from '../update/application-update-service.js';
import { SelectionWindowController } from '../selection/selection-window.js';
import { runSelectionSmokeTest } from '../selection/smoke.js';
import { TrayController } from '../tray/tray-controller.js';
import { buildClientSnapshot } from './client-snapshot.js';
import { mergeSettingsUpdate } from './settings-update.js';

export interface DesktopRuntimeOptions {
  applicationIconPath: string;
  diagnostics: DiagnosticCollector;
  onSnapshotChanged: (snapshot: ClientSnapshot) => void;
  onUpdateChanged: (snapshot: ClientUpdateSnapshot) => void;
  showMainWindow: () => void | Promise<void>;
}

const resolveNativeHelperPath = (): string => {
  const fileName = nativeHelperFileName();
  return app.isPackaged
    ? path.join(process.resourcesPath, 'bin', fileName)
    : path.resolve(app.getAppPath(), 'build/Release', fileName);
};

const setLaunchAtLogin = (openAtLogin: boolean): void => {
  app.setLoginItemSettings(
    createLoginItemSettings(openAtLogin, {
      applicationPath: app.getAppPath(),
      executablePath: process.execPath,
      isPackaged: app.isPackaged,
      platform: process.platform,
    }),
  );
};

export class DesktopRuntime implements ClientBackendPort {
  readonly #capsule = new CapsuleWindowController();
  readonly #configuration: ConfigurationService;
  readonly #dictionaryLearning: DictionaryLearningService;
  readonly #diagnostics: DiagnosticCollector;
  readonly #historyRepository: HistoryRepository;
  readonly #history: HistoryService;
  readonly #hotkey: HotkeyManager;
  readonly #native = new NativeHelperClient(resolveNativeHelperPath());
  readonly #options: DesktopRuntimeOptions;
  readonly #preferenceLearning: WritingPreferenceLearningService;
  readonly #providers: ProviderActivationService;
  readonly #recorder = new RecorderWindowController(
    undefined,
    (level) => this.#capsule.updateLevel(level),
    (requested, resolved) => this.reconcileMicrophoneSelection(requested, resolved),
  );
  readonly #sync: SyncService;
  readonly #tray: TrayController;
  readonly #updates: ApplicationUpdateService;
  #coordinator?: DictationCoordinator;
  #hotkeyQueue: Promise<void> = Promise.resolve();
  #locale: 'en-US' | 'zh-CN' = 'en-US';
  #selection?: SelectionWindowController;
  #started = false;

  constructor(options: DesktopRuntimeOptions) {
    this.#options = options;
    this.#diagnostics = options.diagnostics;
    const userDataPath = app.getPath('userData');
    this.#configuration = new ConfigurationService(
      path.join(userDataPath, 'config.json'),
      new ElectronSecretProtector(),
    );
    this.#dictionaryLearning = new DictionaryLearningService(this.#configuration);
    this.#preferenceLearning = new WritingPreferenceLearningService(this.#configuration);
    this.#historyRepository = new HistoryRepository(path.join(userDataPath, 'history.sqlite3'));
    this.#history = new HistoryService(this.#historyRepository);
    this.#sync = new SyncService({
      appVersion: app.getVersion(),
      configuration: this.#configuration,
      history: this.#historyRepository,
    });
    this.#updates = new ApplicationUpdateService({
      diagnostics: this.#diagnostics,
      onChanged: options.onUpdateChanged,
    });
    this.#providers = new ProviderActivationService({
      configuration: this.#configuration,
      diagnostics: this.#diagnostics,
    });
    this.#hotkey = new HotkeyManager({
      configuration: this.#configuration,
      diagnostics: this.#diagnostics,
      native: this.#native,
      onAction: (action) => this.dispatchHotkey(action),
    });
    this.#tray = new TrayController({
      applicationIconPath: options.applicationIconPath,
      getRecordingState: () => this.#coordinator?.state === 'recording',
      onShowSettings: () => this.#options.showMainWindow(),
      onToggleDictation: () => this.dispatchHotkey(NativeHotkeyAction.Toggle),
    });
  }

  async start(): Promise<void> {
    if (this.#started) throw new Error('Desktop runtime is already active');
    const config = await this.#configuration.load();
    this.#diagnostics.setEnabled(config.diagnostics.automaticCollection);
    this.#diagnostics.log({
      message: 'Desktop runtime startup requested',
      scope: 'app.runtime',
    });
    await this.#providers.activate(config);
    this.#coordinator = new DictationCoordinator({
      diagnostics: this.#diagnostics,
      dictionaryLearning: {
        handleCandidates: (candidates, successPresentationGeneration) =>
          this.handleDictionaryCandidates(candidates, successPresentationGeneration),
      },
      preferenceLearning: {
        handleCandidates: (candidates, application) =>
          this.handleWritingPreferenceCandidates(candidates, application.kind),
      },
      getContext: () =>
        buildUserProfileContext({
          configuration: this.#configuration,
          preferenceLearning: this.#preferenceLearning,
          providers: this.#providers,
        }),
      history: this.#history,
      injection: new ClipboardInjectionService(
        new ElectronClipboardAdapter(),
        {
          paste: async (target) => {
            if (process.platform === 'darwin') {
              return pasteDarwinWithHelperFallback(target, (next) => this.#native.paste(next));
            }
            return this.#native.paste(target);
          },
        },
        undefined,
        process.platform === 'darwin' ? 1_000 : 120,
      ),
      native: this.#native,
      presenter: {
        showConfirm: (result) => this.#capsule.showConfirm(result, this.#locale),
        showError: (reason, detail) => this.#capsule.showError(reason, this.#locale, detail),
        showProcessing: () => this.#capsule.showProcessing(this.#locale),
        showRecording: () => this.#capsule.showRecording(this.#locale),
        showSuccess: (result, delivery) =>
          this.#capsule.showSuccess(result, delivery, this.#locale),
        updateProcessing: (outputText) => this.#capsule.updateProcessing(outputText),
      },
      recorder: this.#recorder,
      selection: {
        prepareVoice: (target) => this.#selection?.prepareVoice(target) ?? Promise.resolve(false),
        processVoice: async (instruction) => {
          this.#capsule.close();
          await this.#selection?.processVoice(instruction);
        },
        showResult: async (result) => {
          this.#capsule.close();
          await this.#selection?.showResult(result);
        },
        close: () => this.#selection?.close(),
      },
      speechProviders: this.#providers.speechProviders,
      textProviders: this.#providers.textProviders,
    });

    try {
      await this.ensureMicrophoneAccess();
      await Promise.all([this.#recorder.initialize(), this.#capsule.warmup()]);
      await this.#native.start();
      try {
        await this.#hotkey.apply(config.dictation.hotkeyAccelerator);
      } catch (error) {
        if (!isNativeHotkeyConflictError(error)) throw error;
        this.#diagnostics.recordIssue({
          context: { accelerator: config.dictation.hotkeyAccelerator },
          error,
          kind: 'configuration',
          source: 'hotkey.configuration',
        });
      }
      this.#hotkey.start();
      if (!process.argv.includes('--smoke-test')) {
        setLaunchAtLogin(config.general.launchAtLogin);
      }
      this.#tray.create(config.general.locale);
      this.#locale = config.general.locale;
      if (!process.argv.includes('--smoke-test')) {
        this.#selection = new SelectionWindowController({
          native: this.#native,
          context: async () => {
            const current = await this.#configuration.load();
            const provider = this.#providers.activeTextProvider;
            return {
              locale: current.general.locale,
              defaultTargetLanguage: current.dictation.defaultTargetLanguage,
              ...(provider ? { provider } : {}),
            };
          },
        });
      }
      this.#updates.start(config.updates);
      this.#started = true;
      this.#diagnostics.log({
        context: {
          fastModeEnabled: config.dictation.fastMode === true,
          speechProviderConfigured: this.#providers.speechProviderId !== undefined,
          textProviderConfigured: this.#providers.textProviderId !== undefined,
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
      this.#selection?.destroy();
      await this.#native.stop();
      this.#recorder.destroy();
      this.#capsule.destroy();
      this.#historyRepository.close();
      throw error;
    }
  }

  async smokeTest(): Promise<boolean> {
    const [recorderReady, nativeReady, dictionaryCapsuleReady] = await Promise.all([
      this.#recorder.smokeTest(),
      this.#native
        .ping()
        .then(() => true)
        .catch(() => false),
      this.#capsule.smokeTestDictionarySuggestion(),
    ]);
    if (!recorderReady || !nativeReady || !dictionaryCapsuleReady) {
      console.error(
        `SMOKE_SURFACE recorder=${String(recorderReady)} native=${String(nativeReady)} capsule=${String(dictionaryCapsuleReady)}`,
      );
    }
    return recorderReady && nativeReady && dictionaryCapsuleReady;
  }

  async selectionSmokeTest(): Promise<void> {
    await runSelectionSmokeTest(this.#native);
  }

  async getClientSnapshot(): Promise<ClientSnapshot> {
    return buildClientSnapshot({
      configuration: this.#configuration,
      preferenceLearning: this.#preferenceLearning,
      sync: this.#sync,
      updates: this.#updates,
    });
  }

  async updateSettings(update: ClientSettingsUpdate): Promise<ClientSnapshot> {
    const current = await this.#configuration.load();
    const requestedSpeechProfile = update.dictation?.activeSpeechProviderProfileId;
    if (
      typeof requestedSpeechProfile === 'string' &&
      !current.providers.some(({ id, kind }) => id === requestedSpeechProfile && kind === 'speech')
    ) {
      throw new Error('Active speech provider profile does not exist');
    }
    const requestedTextProfile = update.dictation?.activeTextProviderProfileId;
    if (
      typeof requestedTextProfile === 'string' &&
      !current.providers.some(({ id, kind }) => id === requestedTextProfile && kind === 'text')
    ) {
      throw new Error('Active text provider profile does not exist');
    }
    const requestedHotkey = update.dictation?.hotkeyAccelerator;
    const hotkeyChanged =
      requestedHotkey !== undefined && requestedHotkey !== current.dictation.hotkeyAccelerator;

    if (hotkeyChanged && requestedHotkey) {
      try {
        await this.#hotkey.apply(requestedHotkey);
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
      next = await this.#configuration.update((config) => mergeSettingsUpdate(config, update));
    } catch (error) {
      if (hotkeyChanged) {
        try {
          await this.#hotkey.apply(current.dictation.hotkeyAccelerator);
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
    this.#diagnostics.setEnabled(next.diagnostics.automaticCollection);
    if (!process.argv.includes('--smoke-test')) {
      setLaunchAtLogin(next.general.launchAtLogin);
    }
    this.applyLocale(next.general.locale);
    this.#updates.configure(next.updates);
    await this.#providers.activate(next);
    this.#diagnostics.log({
      context: {
        changedGroups: Object.keys(update),
        diagnosticFields: Object.keys(update.diagnostics ?? {}),
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

  async setDictionaryLearningEnabled(enabled: boolean): Promise<ClientSnapshot> {
    await this.#configuration.setDictionaryLearningEnabled(enabled);
    return this.getClientSnapshot();
  }

  async setApplicationWritingStyle(
    update: ClientApplicationWritingStyleUpdate,
  ): Promise<ClientSnapshot> {
    await this.#configuration.setApplicationWritingStyle(update);
    return this.getClientSnapshot();
  }

  async setPersonalizationLearningEnabled(enabled: boolean): Promise<ClientSnapshot> {
    await this.#configuration.setPersonalizationLearningEnabled(enabled);
    return this.getClientSnapshot();
  }

  async acceptWritingPreference(id: string): Promise<ClientSnapshot> {
    await this.#preferenceLearning.accept(id);
    return this.getClientSnapshot();
  }

  async rejectWritingPreference(id: string): Promise<ClientSnapshot> {
    await this.#preferenceLearning.reject(id);
    return this.getClientSnapshot();
  }

  async removeWritingPreference(id: string): Promise<ClientSnapshot> {
    await this.#preferenceLearning.remove(id);
    return this.getClientSnapshot();
  }

  async clearPersonalizationMemory(): Promise<ClientSnapshot> {
    await this.#preferenceLearning.clear();
    return this.getClientSnapshot();
  }

  async requestAccessibilityAccess(): Promise<ClientSnapshot> {
    if (process.platform === 'darwin') {
      systemPreferences.isTrustedAccessibilityClient(true);
      await shell.openExternal(
        'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
      );
    }
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
    if (profile.kind === 'speech' && !current.dictation.activeSpeechProviderProfileId) {
      next = await this.#configuration.update((config) => ({
        ...config,
        dictation: {
          ...config.dictation,
          activeSpeechProviderProfileId: profile.id,
        },
      }));
    } else if (profile.kind === 'text' && !current.dictation.activeTextProviderProfileId) {
      next = await this.#configuration.update((config) => ({
        ...config,
        dictation: {
          ...config.dictation,
          activeTextProviderProfileId: profile.id,
        },
      }));
    }
    await this.#providers.activate(next);
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
    await this.#providers.activate(next);
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
      await testProviderConnection(profile, this.#providers.providerFetch(profile));
    } catch (error) {
      if (error instanceof ProviderContractError && error.code === 'EMPTY_RESULT') {
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

  acknowledgeDiagnostics(issueIds: readonly string[]): ClientDiagnosticSnapshot {
    return this.#diagnostics.acknowledge(issueIds);
  }

  async clearDiagnostics(): Promise<ClientDiagnosticSnapshot> {
    return this.#diagnostics.clear();
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
    await this.#diagnostics.flush();
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

  getSyncConfig(): Promise<ClientSyncSnapshot> {
    return this.#sync.snapshot();
  }

  async updateSyncConfig(update: ClientSyncConfigUpdate): Promise<ClientSnapshot> {
    await this.#sync.updateConfig(update);
    return this.getClientSnapshot();
  }

  async testSyncConnection(): Promise<{ ok: true }> {
    await this.#sync.testConnection();
    return { ok: true };
  }

  createBackup(): Promise<ClientSyncResult> {
    return this.#sync.createBackup();
  }

  listRemoteBackups(): Promise<readonly SyncBackupInfo[]> {
    return this.#sync.listRemoteBackups();
  }

  applyBackup(remoteFile: string): Promise<ClientSyncResult> {
    return this.#sync.applyBackup(remoteFile);
  }

  async deleteBackup(remoteFile: string): Promise<{ ok: true }> {
    await this.#sync.deleteBackup(remoteFile);
    return { ok: true };
  }

  async generateBackupCode(): Promise<string> {
    return this.#sync.generateBackupCode();
  }

  async setHotkeyCaptureActive(active: boolean, sender?: WebContents): Promise<void> {
    return this.#hotkey.setCaptureActive(active, sender);
  }

  async stop(): Promise<void> {
    if (!this.#started) return;
    this.#started = false;
    this.#selection?.destroy();
    this.#hotkey.stop();
    this.#tray.destroy();
    this.#updates.stop();
    this.#capsule.destroy();
    this.#recorder.destroy();
    await this.#native.stop();
    this.#historyRepository.close();
    this.#diagnostics.log({
      message: 'Desktop runtime stopped',
      scope: 'app.runtime',
    });
    await this.#diagnostics.flush();
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
              const errors: Record<DictionaryEntryError['code'], DictionarySuggestionError> = {
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

  private handleWritingPreferenceCandidates(
    candidates: readonly WritingPreferenceCandidate[],
    application: TargetApplicationKind,
  ): void {
    void this.#preferenceLearning
      .observe(candidates, application)
      .then(async (changed) => {
        if (!changed) return;
        this.#options.onSnapshotChanged(await this.getClientSnapshot());
        this.#diagnostics.log({
          context: { candidateCount: candidates.length },
          message: 'Writing preference candidates updated',
          scope: 'personalization.learning',
        });
      })
      .catch((error: unknown) => {
        this.#diagnostics.recordIssue({
          error,
          kind: 'internal',
          source: 'personalization.learning',
        });
      });
  }

  private reconcileMicrophoneSelection(
    requested: MicrophoneSelection,
    resolved: MicrophoneSelection,
  ): void {
    void (async () => {
      const devices = await this.#recorder.listDevices();
      const verified = resolveMicrophoneSelection(requested, devices);
      if (!verified || verified.deviceId !== resolved.deviceId) {
        throw new Error('Resolved microphone could not be verified');
      }

      let changed = false;
      await this.#configuration.update((config) => {
        if (
          config.dictation.microphoneDeviceId !== requested.deviceId ||
          config.dictation.microphoneDeviceLabel !== requested.label ||
          (config.dictation.microphoneDeviceId === verified.deviceId &&
            config.dictation.microphoneDeviceLabel === verified.label)
        ) {
          return config;
        }
        changed = true;
        const dictation = {
          ...config.dictation,
          microphoneDeviceId: verified.deviceId,
        };
        if (verified.label) {
          dictation.microphoneDeviceLabel = verified.label;
        } else {
          delete dictation.microphoneDeviceLabel;
        }
        return { ...config, dictation };
      });
      if (!changed) return;
      this.#options.onSnapshotChanged(await this.getClientSnapshot());
      this.#diagnostics.log({
        context: {
          identifierChanged: requested.deviceId !== verified.deviceId,
          labelStored: verified.label !== undefined,
        },
        message: 'Selected microphone identity refreshed',
        scope: 'recorder.selection',
      });
    })().catch((error: unknown) => {
      this.#diagnostics.recordIssue({
        error,
        kind: 'microphone',
        source: 'recorder.selection-recovery',
      });
    });
  }

  private dispatchHotkey(action: NativeHotkeyAction): void {
    if (this.#selection?.isBusy || this.#coordinator?.state === 'processing') return;
    this.#hotkeyQueue = this.#hotkeyQueue
      .then(async () => {
        await this.#coordinator?.handleHotkey(action);
        this.#tray.refreshMenu();
      })
      .catch((error: unknown) => {
        console.error('Dictation operation failed', error);
        this.#diagnostics.log({
          context: { error },
          level: 'warning',
          message: 'Dictation operation returned an error',
          scope: 'dictation.dispatch',
        });
        this.#tray.refreshMenu();
      });
  }

  private async ensureMicrophoneAccess(): Promise<void> {
    if (process.platform !== 'darwin') return;
    if (process.argv.includes('--smoke-test')) return;
    if (systemPreferences.getMediaAccessStatus('microphone') === 'granted') {
      return;
    }
    await systemPreferences.askForMediaAccess('microphone');
  }

  private applyLocale(locale: 'en-US' | 'zh-CN'): void {
    this.#locale = locale;
    this.#tray.applyLocale(locale);
  }
}
