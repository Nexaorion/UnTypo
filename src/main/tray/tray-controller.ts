import path from 'node:path';
import { Menu, Tray, app, nativeImage, type MenuItemConstructorOptions } from 'electron';

type TrayLocale = 'en-US' | 'zh-CN';

export interface TrayControllerOptions {
  applicationIconPath: string;
  getRecordingState: () => boolean;
  onShowSettings: () => void | Promise<void>;
  onToggleDictation: () => void;
}

export class TrayController {
  #locale: TrayLocale = 'en-US';
  #tray?: Tray;
  readonly #options: TrayControllerOptions;

  constructor(options: TrayControllerOptions) {
    this.#options = options;
  }

  create(locale: TrayLocale): void {
    const iconPath =
      process.platform === 'darwin'
        ? this.#darwinTrayIconPath()
        : this.#options.applicationIconPath;
    const icon =
      process.platform === 'darwin'
        ? nativeImage.createFromPath(iconPath)
        : nativeImage.createFromPath(iconPath).resize({
            height: 16,
            width: 16,
          });
    if (icon.isEmpty()) {
      throw new Error(`Application tray icon could not be loaded: ${iconPath}`);
    }
    if (process.platform === 'darwin') icon.setTemplateImage(true);
    this.#tray = new Tray(icon);
    if (process.platform !== 'darwin') {
      this.#tray.on('click', () => void this.#options.onShowSettings());
    }
    this.applyLocale(locale);
  }

  applyLocale(locale: TrayLocale): void {
    this.#locale = locale;
    this.#tray?.setToolTip(locale === 'zh-CN' ? 'UnTypo 听写' : 'UnTypo Dictation');
    this.refreshMenu();
  }

  refreshMenu(): void {
    if (!this.#tray) return;
    const locale = this.#locale;
    const isRecording = this.#options.getRecordingState();
    const template: MenuItemConstructorOptions[] = [
      {
        click: this.#options.onToggleDictation,
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
        click: () => void this.#options.onShowSettings(),
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

  destroy(): void {
    this.#tray?.destroy();
    this.#tray = undefined;
  }

  #darwinTrayIconPath(): string {
    const fileName = 'untypo-trayTemplate.png';
    return app.isPackaged
      ? path.join(process.resourcesPath, fileName)
      : path.join(app.getAppPath(), 'assets', fileName);
  }
}
