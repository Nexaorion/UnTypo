import {
  Menu,
  Tray,
  app,
  nativeImage,
  type MenuItemConstructorOptions,
} from 'electron';
import path from 'node:path';
import { MockDictationProvider } from '../../core/providers/mock-provider.js';
import {
  OpenAIProvider,
  type OpenAIProviderConfiguration,
} from '../../core/providers/openai-provider.js';
import { ProviderRegistry } from '../../core/providers/registry.js';
import type { UserProfileContext } from '../../core/providers/contracts.js';
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

const sensitiveValueKeyPattern = /(api.?key|password|secret|token)/iu;

const toOpenAIConfiguration = (
  profile: ProviderProfile,
): OpenAIProviderConfiguration | undefined => {
  const apiKey = profile.secrets.apiKey;
  const textModel = profile.values.textModel;
  const transcriptionModel = profile.values.transcriptionModel;
  if (
    !isString(apiKey) ||
    !isString(textModel) ||
    !isString(transcriptionModel)
  ) {
    return undefined;
  }
  const baseUrl = profile.values.baseUrl;
  const allowInsecurePrivateEndpoint =
    profile.values.allowInsecurePrivateEndpoint;
  return {
    apiKey,
    textModel,
    transcriptionModel,
    ...(isString(baseUrl) ? { baseUrl } : {}),
    ...(typeof allowInsecurePrivateEndpoint === 'boolean'
      ? { allowInsecurePrivateEndpoint }
      : {}),
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
  readonly #native = new NativeHelperClient(resolveNativeHelperPath());
  readonly #options: DesktopRuntimeOptions;
  readonly #providers = new ProviderRegistry();
  readonly #recorder = new RecorderWindowController();
  #coordinator?: DictationCoordinator;
  #hotkeyQueue: Promise<void> = Promise.resolve();
  #locale: 'en-US' | 'zh-CN' = 'en-US';
  #providerId = 'mock';
  #removeHotkeyListener?: () => void;
  #started = false;
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
    this.#providers.register(
      new MockDictationProvider({
        polishedText: 'UnTypo desktop dictation is ready.',
        transcript: 'UnTypo desktop dictation is ready.',
      }),
    );
  }

  async start(): Promise<void> {
    if (this.#started) throw new Error('Desktop runtime is already active');
    const config = await this.#configuration.load();
    await this.activateConfiguredProvider(config);
    this.#coordinator = new DictationCoordinator({
      fallback: this.#capsule,
      getContext: async () => {
        const current = await this.#configuration.load();
        const activeProfile = current.dictation.activeProviderProfileId
          ? current.providers.find(
              (profile) =>
                profile.id === current.dictation.activeProviderProfileId,
            )
          : undefined;
        const transcriptionModel = activeProfile?.values.transcriptionModel;
        return {
          history: current.history,
          ...(typeof transcriptionModel === 'string' && transcriptionModel
            ? { modelName: transcriptionModel }
            : { modelName: this.#providerId }),
          options: {
            defaultTargetLanguage: current.dictation.defaultTargetLanguage,
            dictionary: current.dictionary,
            language: current.dictation.language,
            preferIntegratedProcess: false,
            profile: await this.#configuration.getProfile(),
          },
          providerId: this.#providerId,
          uiLanguage: current.general.locale,
        };
      },
      history: this.#history,
      injection: new ClipboardInjectionService(
        new ElectronClipboardAdapter(),
        this.#native,
      ),
      native: this.#native,
      providers: this.#providers,
      recorder: this.#recorder,
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
        providerId: provider.providerId,
        values: Object.fromEntries(
          Object.entries(provider.values).filter(
            ([key]) => !sensitiveValueKeyPattern.test(key),
          ),
        ),
      })),
      settings: {
        dictation: {
          ...(config.dictation.activeProviderProfileId
            ? {
                activeProviderProfileId:
                  config.dictation.activeProviderProfileId,
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
    const requestedProfile = update.dictation?.activeProviderProfileId;
    if (
      typeof requestedProfile === 'string' &&
      !current.providers.some((provider) => provider.id === requestedProfile)
    ) {
      throw new Error('Active provider profile does not exist');
    }
    const nextHotkey = parseHotkeyAccelerator(
      update.dictation?.hotkeyAccelerator ??
        current.dictation.hotkeyAccelerator,
      update.dictation?.hotkeyMode ?? current.dictation.hotkeyMode,
    );

    const next = await this.#configuration.update((config) => {
      const { activeProviderProfileId, ...dictationUpdate } =
        update.dictation ?? {};
      const dictation = { ...config.dictation, ...dictationUpdate };
      if (activeProviderProfileId === null)
        delete dictation.activeProviderProfileId;
      else if (activeProviderProfileId !== undefined)
        dictation.activeProviderProfileId = activeProviderProfileId;
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
    await this.activateConfiguredProvider(next);
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
    const configuration = toOpenAIConfiguration(profile);
    if (!configuration) throw new Error('Provider profile is incomplete');
    new OpenAIProvider(configuration);
    await this.#configuration.upsertProvider(profile);
    const current = await this.#configuration.load();
    const next = current.dictation.activeProviderProfileId
      ? current
      : await this.#configuration.update((config) => ({
          ...config,
          dictation: {
            ...config.dictation,
            activeProviderProfileId: profile.id,
          },
        }));
    await this.activateConfiguredProvider(next);
    return this.getClientSnapshot();
  }

  async removeProvider(profileId: string): Promise<ClientSnapshot> {
    const current = await this.#configuration.removeProvider(profileId);
    const next =
      current.dictation.activeProviderProfileId === profileId
        ? await this.#configuration.update((config) => {
            const dictation = { ...config.dictation };
            delete dictation.activeProviderProfileId;
            return { ...config, dictation };
          })
        : current;
    await this.activateConfiguredProvider(next);
    return this.getClientSnapshot();
  }

  async testProvider(profileId: string): Promise<{ ok: true }> {
    const profile = await this.#configuration.getProvider(profileId);
    if (!profile || profile.providerId !== 'openai') {
      throw new Error('Provider profile does not exist');
    }
    const configuration = toOpenAIConfiguration(profile);
    if (!configuration) throw new Error('Provider profile is incomplete');
    const provider = new OpenAIProvider(configuration);
    await provider.classifyIntent('Transcribe this connection test.', {
      defaultTargetLanguage: 'en-US',
      dictionary: [],
      locale: 'en-US',
    });
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

  private async activateConfiguredProvider(
    config: Awaited<ReturnType<ConfigurationService['load']>>,
  ): Promise<void> {
    this.#providerId = 'mock';
    const profileIds = config.dictation.activeProviderProfileId
      ? [config.dictation.activeProviderProfileId]
      : config.providers.map(({ id }) => id);
    for (const profileId of profileIds) {
      const profile = await this.#configuration.getProvider(profileId);
      if (!profile || profile.providerId !== 'openai') continue;
      const configuration = toOpenAIConfiguration(profile);
      if (!configuration) continue;
      this.#providers.replace(new OpenAIProvider(configuration));
      this.#providerId = 'openai';
      return;
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
