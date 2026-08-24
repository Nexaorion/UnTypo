import {
  Menu,
  Tray,
  app,
  nativeImage,
  type MenuItemConstructorOptions,
} from 'electron';
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
import { MockDictationProvider } from '../../core/providers/mock-provider.js';
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
  ClientHistoryQuery,
  ClientHistoryRecord,
  ClientProviderInput,
  ClientSettingsUpdate,
  ClientSnapshot,
  ClientUsageStats,
} from '../../shared/ipc.js';
import { CapsuleWindowController } from '../capsule/capsule-window.js';
import { ClipboardInjectionService } from '../dictation/clipboard.js';
import { DictationCoordinator } from '../dictation/coordinator.js';
import { ElectronClipboardAdapter } from '../dictation/electron-clipboard.js';
import { NativeHelperClient } from '../native/client.js';
import { parseHotkeyAccelerator } from '../native/hotkey.js';
import { NativeHotkeyAction } from '../native/protocol.js';
import { RecorderWindowController } from '../recording/recorder-window.js';
import { ConfigurationService } from '../storage/configuration.js';
import type { ProviderProfile } from '../storage/configuration.js';
import { ElectronSecretProtector } from '../storage/electron-secret-protector.js';
import { HistoryRepository, HistoryService } from '../storage/history.js';

export interface DesktopRuntimeOptions {
  showMainWindow: () => void | Promise<void>;
}

const trayIconPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/l4fWpwAAAABJRU5ErkJggg==',
  'base64',
);

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
): TextGenerationProvider => {
  if (profile.kind !== 'text') {
    throw new Error('Text provider profile has the wrong kind');
  }
  const configuration = toProviderConfiguration(profile);
  if (!configuration) throw new Error('Provider profile is incomplete');
  if (profile.providerId === 'openai-compatible-text') {
    return new OpenAICompatibleTextProvider(configuration);
  }
  if (profile.providerId === 'openai-responses-text') {
    return new OpenAIResponsesTextProvider(configuration);
  }
  if (profile.providerId === 'anthropic-text') {
    return new AnthropicTextProvider(configuration);
  }
  throw new Error('Text provider profile has an unsupported provider id');
};

const createSpeechProvider = (
  profile: ProviderProfile,
): SpeechRecognitionProvider => {
  if (profile.kind !== 'speech') {
    throw new Error('Speech provider profile has the wrong kind');
  }
  const configuration = toProviderConfiguration(profile);
  if (!configuration) throw new Error('Provider profile is incomplete');
  if (profile.providerId === 'openai-compatible-speech') {
    return new OpenAICompatibleSpeechProvider(configuration);
  }
  if (profile.providerId === 'aliyun-bailian-speech') {
    return new AliyunBailianSpeechProvider(configuration);
  }
  throw new Error('Speech provider profile has an unsupported provider id');
};

const createSilentWav = (): AudioPayload => {
  const channels = 1;
  const durationMs = 250;
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
  readonly #historyRepository: HistoryRepository;
  readonly #history: HistoryService;
  readonly #mockProvider = new MockDictationProvider({
    polishedText: 'UnTypo desktop dictation is ready.',
    transcript: 'UnTypo desktop dictation is ready.',
  });
  readonly #native = new NativeHelperClient(resolveNativeHelperPath());
  readonly #options: DesktopRuntimeOptions;
  readonly #recorder = new RecorderWindowController();
  readonly #speechProviders = new SpeechProviderRegistry();
  readonly #textProviders = new TextProviderRegistry();
  #coordinator?: DictationCoordinator;
  #hotkeyQueue: Promise<void> = Promise.resolve();
  #locale: 'en-US' | 'zh-CN' = 'en-US';
  #removeHotkeyListener?: () => void;
  #speechProviderId = 'mock';
  #started = false;
  #textProviderId: string | undefined = 'mock';
  #tray?: Tray;

  constructor(options: DesktopRuntimeOptions) {
    this.#options = options;
    const userDataPath = app.getPath('userData');
    this.#configuration = new ConfigurationService(
      path.join(userDataPath, 'config.json'),
      new ElectronSecretProtector(),
    );
    this.#historyRepository = new HistoryRepository(
      path.join(userDataPath, 'history.sqlite3'),
    );
    this.#history = new HistoryService(this.#historyRepository);
    this.#speechProviders.register(this.#mockProvider);
    this.#textProviders.register(this.#mockProvider);
  }

  async start(): Promise<void> {
    if (this.#started) throw new Error('Desktop runtime is already active');
    const config = await this.#configuration.load();
    await this.activateConfiguredProviders(config);
    this.#coordinator = new DictationCoordinator({
      fallback: this.#capsule,
      getContext: async () => {
        const current = await this.#configuration.load();
        const activeSpeechProfile = current.providers.find(
          ({ id, kind }) => id === this.#speechProviderId && kind === 'speech',
        );
        return {
          history: current.history,
          modelName:
            activeSpeechProfile?.values.model ?? this.#speechProviderId,
          options: {
            defaultTargetLanguage: current.dictation.defaultTargetLanguage,
            dictionary: current.dictionary,
            language: current.dictation.language,
            preferIntegratedProcess: false,
            profile: await this.#configuration.getProfile(),
          },
          speechProviderId: this.#speechProviderId,
          ...(this.#textProviderId
            ? { textProviderId: this.#textProviderId }
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
      recorder: this.#recorder,
      speechProviders: this.#speechProviders,
      textProviders: this.#textProviders,
    });

    try {
      await this.#recorder.initialize();
      await this.#native.start();
      this.#native.configureHotkey(
        parseHotkeyAccelerator(
          config.dictation.hotkeyAccelerator,
          config.dictation.hotkeyMode,
        ),
      );
      this.#removeHotkeyListener = this.#native.onHotkey((action) =>
        this.dispatchHotkey(action),
      );
      app.setLoginItemSettings({ openAtLogin: config.general.launchAtLogin });
      this.createTray(config.general.locale);
      this.#started = true;
    } catch (error) {
      await this.#native.stop();
      this.#recorder.destroy();
      this.#capsule.destroy();
      this.#historyRepository.close();
      throw error;
    }
  }

  async smokeTest(): Promise<boolean> {
    const [recorderReady] = await Promise.all([
      this.#recorder.smokeTest(),
      this.#native.ping(),
    ]);
    return recorderReady;
  }

  async getClientSnapshot(): Promise<ClientSnapshot> {
    const [config, profile] = await Promise.all([
      this.#configuration.load(),
      this.#configuration.getProfile(),
    ]);
    return {
      dictionary: config.dictionary,
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
          hotkeyAccelerator: config.dictation.hotkeyAccelerator,
          hotkeyMode: config.dictation.hotkeyMode,
          language: config.dictation.language,
        },
        general: config.general,
        history: config.history,
      },
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
    const nextHotkey = parseHotkeyAccelerator(
      update.dictation?.hotkeyAccelerator ??
        current.dictation.hotkeyAccelerator,
      update.dictation?.hotkeyMode ?? current.dictation.hotkeyMode,
    );

    const next = await this.#configuration.update((config) => {
      const {
        activeSpeechProviderProfileId,
        activeTextProviderProfileId,
        ...dictationUpdate
      } = update.dictation ?? {};
      const dictation = { ...config.dictation, ...dictationUpdate };
      if (activeSpeechProviderProfileId === null) {
        delete dictation.activeSpeechProviderProfileId;
      } else if (activeSpeechProviderProfileId !== undefined) {
        dictation.activeSpeechProviderProfileId = activeSpeechProviderProfileId;
      }
      if (activeTextProviderProfileId === null) {
        delete dictation.activeTextProviderProfileId;
      } else if (activeTextProviderProfileId !== undefined) {
        dictation.activeTextProviderProfileId = activeTextProviderProfileId;
      }
      return {
        ...config,
        dictation,
        general: { ...config.general, ...update.general },
        history: { ...config.history, ...update.history },
      };
    });
    this.#native.configureHotkey(nextHotkey);
    app.setLoginItemSettings({ openAtLogin: next.general.launchAtLogin });
    this.applyLocale(next.general.locale);
    await this.activateConfiguredProviders(next);
    return this.getClientSnapshot();
  }

  async setDictionary(entries: readonly string[]): Promise<ClientSnapshot> {
    await this.#configuration.setDictionary(entries);
    return this.getClientSnapshot();
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
    return this.getClientSnapshot();
  }

  async removeProvider(profileId: string): Promise<ClientSnapshot> {
    const next = await this.#configuration.removeProvider(profileId);
    await this.activateConfiguredProviders(next);
    return this.getClientSnapshot();
  }

  async testProvider(profileId: string): Promise<{ ok: true }> {
    const profile = await this.#configuration.getProvider(profileId);
    if (!profile) throw new Error('Provider profile does not exist');
    if (profile.kind === 'text') {
      const provider = createTextProvider(profile);
      if (!provider.classifyIntent) {
        throw new Error('Text provider cannot classify intent');
      }
      await provider.classifyIntent('Transcribe this connection test.', {
        defaultTargetLanguage: 'en-US',
        dictionary: [],
        locale: 'en-US',
      });
    } else {
      const provider = createSpeechProvider(profile);
      try {
        await provider.transcribe(createSilentWav(), {
          dictionary: [],
          language: 'en-US',
        });
      } catch (error) {
        if (
          !(error instanceof ProviderContractError) ||
          error.code !== 'EMPTY_RESULT'
        ) {
          throw error;
        }
      }
    }
    return { ok: true };
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

  async stop(): Promise<void> {
    if (!this.#started) return;
    this.#started = false;
    this.#removeHotkeyListener?.();
    this.#removeHotkeyListener = undefined;
    this.#tray?.destroy();
    this.#tray = undefined;
    this.#capsule.destroy();
    this.#recorder.destroy();
    await this.#native.stop();
    this.#historyRepository.close();
  }

  private async activateConfiguredProviders(
    config: Awaited<ReturnType<ConfigurationService['load']>>,
  ): Promise<void> {
    this.#speechProviders.clear();
    this.#textProviders.clear();
    this.#speechProviders.register(this.#mockProvider);
    this.#textProviders.register(this.#mockProvider);
    this.#speechProviderId = 'mock';

    const speechProfileId = config.dictation.activeSpeechProviderProfileId;
    if (speechProfileId) {
      const profile = await this.#configuration.getProvider(speechProfileId);
      if (!profile) {
        throw new Error('Active speech provider profile does not exist');
      }
      const provider = createSpeechProvider(profile);
      this.#speechProviders.replace(provider);
      this.#speechProviderId = provider.id;
    }

    this.#textProviderId =
      this.#speechProviderId === 'mock' ? 'mock' : undefined;
    const textProfileId = config.dictation.activeTextProviderProfileId;
    if (textProfileId) {
      const profile = await this.#configuration.getProvider(textProfileId);
      if (!profile) {
        throw new Error('Active text provider profile does not exist');
      }
      const provider = createTextProvider(profile);
      this.#textProviders.replace(provider);
      this.#textProviderId = provider.id;
    }
  }

  private dispatchHotkey(action: NativeHotkeyAction): void {
    this.#hotkeyQueue = this.#hotkeyQueue
      .then(async () => {
        await this.#coordinator?.handleHotkey(action);
        this.refreshTrayMenu();
      })
      .catch((error: unknown) => {
        console.error('Dictation operation failed', error);
        this.refreshTrayMenu();
      });
  }

  private createTray(locale: 'en-US' | 'zh-CN'): void {
    const icon = nativeImage.createFromBuffer(trayIconPng).resize({
      height: 16,
      width: 16,
    });
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
