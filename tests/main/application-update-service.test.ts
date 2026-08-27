import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppUpdater } from 'electron-updater';

vi.mock('electron', () => ({
  app: { getVersion: () => '0.1.3', isPackaged: false },
}));

vi.mock('electron-updater', () => ({ autoUpdater: {} }));

import {
  ApplicationUpdateService,
  isNewerVersion,
} from '../../src/main/update/application-update-service';

class FakeUpdater extends EventEmitter {
  allowDowngrade = true;
  allowPrerelease = true;
  autoDownload = true;
  autoInstallOnAppQuit = true;
  logger: unknown;
  readonly checkForUpdates = vi.fn();
  readonly downloadUpdate = vi.fn();
  readonly quitAndInstall = vi.fn();
}

const releaseResponse = (version: string) =>
  new Response(
    JSON.stringify({
      name: `v${version}`,
      notes: null,
      pub_date: '2026-08-27T00:00:00.000Z',
      url: `https://github.com/Nexaorion/UnTypo/releases/download/v${version}/UnTypo-Setup-${version}.exe`,
    }),
    { headers: { 'content-type': 'application/json' }, status: 200 },
  );

describe('ApplicationUpdateService', () => {
  let updater: FakeUpdater;

  beforeEach(() => {
    updater = new FakeUpdater();
  });

  it('accepts only a strictly newer semantic version', () => {
    expect(isNewerVersion('0.2.0', '0.1.3')).toBe(true);
    expect(isNewerVersion('v0.1.3', '0.1.3')).toBe(false);
    expect(isNewerVersion('0.1.1', '0.1.3')).toBe(false);
    expect(isNewerVersion('1.0.0', '1.0.0-beta.2')).toBe(true);
    expect(isNewerVersion('1.0.0-beta.1', '1.0.0')).toBe(false);
    expect(isNewerVersion('1.0.0-beta.2', '1.0.0-beta')).toBe(true);
    expect(isNewerVersion('1.0.0-beta', '1.0.0-beta.2')).toBe(false);
  });

  it('ignores the older release currently returned by Hazel', async () => {
    const onChanged = vi.fn();
    const service = new ApplicationUpdateService({
      diagnostics: { log: vi.fn() } as never,
      fetchImplementation: vi.fn(() =>
        Promise.resolve(releaseResponse('0.1.1')),
      ),
      isPackaged: true,
      onChanged,
      platform: 'win32',
      updater: updater as unknown as AppUpdater,
      version: '0.1.3',
    });
    service.start({ autoCheck: false, autoDownload: false });

    await expect(service.checkForUpdates()).resolves.toMatchObject({
      currentVersion: '0.1.3',
      status: 'up-to-date',
    });
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
    expect(onChanged).toHaveBeenCalled();
    service.stop();
  });

  it('downloads a Hazel-discovered release through signed NSIS metadata', async () => {
    updater.checkForUpdates.mockResolvedValue({
      isUpdateAvailable: true,
      updateInfo: { version: '0.2.0' },
    });
    updater.downloadUpdate.mockImplementation(() => {
      updater.emit('update-downloaded', { version: '0.2.0' });
      return Promise.resolve([]);
    });
    const service = new ApplicationUpdateService({
      diagnostics: { log: vi.fn() } as never,
      fetchImplementation: vi.fn(() =>
        Promise.resolve(releaseResponse('0.2.0')),
      ),
      isPackaged: true,
      onChanged: vi.fn(),
      platform: 'win32',
      updater: updater as unknown as AppUpdater,
      version: '0.1.3',
    });
    service.start({ autoCheck: false, autoDownload: false });

    await expect(service.checkForUpdates()).resolves.toMatchObject({
      availableVersion: '0.2.0',
      status: 'available',
    });
    await expect(service.downloadUpdate()).resolves.toMatchObject({
      availableVersion: '0.2.0',
      status: 'downloaded',
    });
    await expect(service.checkForUpdates()).resolves.toMatchObject({
      status: 'downloaded',
    });
    expect(updater.checkForUpdates).toHaveBeenCalledOnce();
    expect(updater.downloadUpdate).toHaveBeenCalledOnce();
    service.stop();
  });

  it('keeps the discovery timeout active while the Hazel response body stalls', async () => {
    vi.useFakeTimers();
    const onChanged = vi.fn();
    const fetchImplementation = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        Promise.resolve({
          ok: true,
          json: () =>
            new Promise((_, reject) => {
              init?.signal?.addEventListener('abort', () => {
                reject(new DOMException('Timed out', 'AbortError'));
              });
            }),
          status: 200,
        } as Response),
    );
    const service = new ApplicationUpdateService({
      diagnostics: { log: vi.fn() } as never,
      fetchImplementation,
      isPackaged: true,
      onChanged,
      platform: 'win32',
      updater: updater as unknown as AppUpdater,
      version: '0.1.3',
    });
    service.start({ autoCheck: false, autoDownload: false });

    const check = service.checkForUpdates();
    await vi.advanceTimersByTimeAsync(15_000);

    await expect(check).resolves.toMatchObject({ status: 'error' });
    expect(onChanged).toHaveBeenCalled();
    service.stop();
    vi.useRealTimers();
  });
});
