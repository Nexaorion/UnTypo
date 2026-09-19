import { app } from 'electron';

export type DarwinDockVisibilityOptions = {
  isQuitting: boolean;
  platform?: NodeJS.Platform;
};

export const keepDarwinDockVisible = (options: DarwinDockVisibilityOptions): void => {
  const platform = options.platform ?? process.platform;
  if (platform !== 'darwin' || options.isQuitting) return;
  app.setActivationPolicy('regular');
  void app.dock?.show();
};

export const hideMainWindowOnClose = (
  event: { preventDefault: () => void },
  window: { hide: () => void },
  options: DarwinDockVisibilityOptions & { isSmokeTest: boolean },
): void => {
  if (options.isQuitting || options.isSmokeTest) return;
  event.preventDefault();
  window.hide();
  keepDarwinDockVisible(options);
};
