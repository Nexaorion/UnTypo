import { describe, expect, it } from 'vitest';
import { createLoginItemSettings } from '../../src/main/login-item';

describe('createLoginItemSettings', () => {
  it('launches the application directory with Electron on Windows in development', () => {
    expect(
      createLoginItemSettings(true, {
        applicationPath: 'E:\\Code\\UnTypo Project',
        executablePath: 'E:\\Code\\UnTypo Project\\node_modules\\electron\\electron.exe',
        isPackaged: false,
        platform: 'win32',
      }),
    ).toEqual({
      args: ['"E:\\Code\\UnTypo Project"'],
      openAtLogin: true,
      path: 'E:\\Code\\UnTypo Project\\node_modules\\electron\\electron.exe',
    });
  });

  it('uses the packaged Windows executable without application arguments', () => {
    expect(
      createLoginItemSettings(true, {
        applicationPath: 'C:\\Program Files\\UnTypo\\resources\\app.asar',
        executablePath: 'C:\\Program Files\\UnTypo\\UnTypo.exe',
        isPackaged: true,
        platform: 'win32',
      }),
    ).toEqual({ openAtLogin: true });
  });

  it('leaves macOS login item registration to Electron', () => {
    expect(
      createLoginItemSettings(true, {
        applicationPath: '/Applications/UnTypo.app/Contents/Resources/app.asar',
        executablePath: '/Applications/UnTypo.app/Contents/MacOS/UnTypo',
        isPackaged: true,
        platform: 'darwin',
      }),
    ).toEqual({ openAtLogin: true });
  });

  it('uses the same Windows development target when disabling the login item', () => {
    expect(
      createLoginItemSettings(false, {
        applicationPath: 'E:\\Code\\UnTypo',
        executablePath: 'E:\\Code\\UnTypo\\node_modules\\electron\\electron.exe',
        isPackaged: false,
        platform: 'win32',
      }),
    ).toEqual({
      args: ['"E:\\Code\\UnTypo"'],
      openAtLogin: false,
      path: 'E:\\Code\\UnTypo\\node_modules\\electron\\electron.exe',
    });
  });
});
