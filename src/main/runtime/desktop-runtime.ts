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
    await this.registerConfiguredProvider(config.providers.map(({ id }) => id));
    this.#coordinator = new DictationCoordinator({
      fallback: this.#capsule,
      getContext: async () => {
        const current = await this.#configuration.load();
        return {
          history: current.history,
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

  private async registerConfiguredProvider(
    profileIds: readonly string[],
  ): Promise<void> {
    for (const profileId of profileIds) {
      const profile = await this.#configuration.getProvider(profileId);
      if (!profile || profile.providerId !== 'openai') continue;
      const configuration = toOpenAIConfiguration(profile);
      if (!configuration) continue;
      this.#providers.register(new OpenAIProvider(configuration));
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
    this.#locale = locale;
    const icon = nativeImage.createFromBuffer(trayIconPng).resize({
      height: 16,
      width: 16,
    });
    this.#tray = new Tray(icon);
    this.#tray.setToolTip(
      locale === 'zh-CN' ? 'UnTypo 听写' : 'UnTypo Dictation',
    );
    this.#tray.on('click', () => void this.#options.showMainWindow());
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
