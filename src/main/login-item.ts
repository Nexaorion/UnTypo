export interface LoginItemEnvironment {
  applicationPath: string;
  executablePath: string;
  isPackaged: boolean;
  platform: NodeJS.Platform;
}

export interface LoginItemSettings {
  args?: string[];
  openAtLogin: boolean;
  path?: string;
}

export const createLoginItemSettings = (
  openAtLogin: boolean,
  environment: LoginItemEnvironment,
): LoginItemSettings => {
  if (environment.platform !== 'win32' || environment.isPackaged) {
    return { openAtLogin };
  }

  return {
    args: [`"${environment.applicationPath}"`],
    openAtLogin,
    path: environment.executablePath,
  };
};
