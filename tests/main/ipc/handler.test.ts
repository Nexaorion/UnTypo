import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientSnapshot } from '../../../src/shared/client-ipc';
import { IPC_CHANNELS } from '../../../src/shared/client-ipc';

const electronMocks = vi.hoisted(() => {
  const handlers = new Map<string, (...arguments_: unknown[]) => unknown>();
  const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
  const ipcMain = {
    handle: vi.fn((channel: string, handler: (...arguments_: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    }),
    removeHandler: vi.fn((channel: string) => {
      handlers.delete(channel);
    }),
  };
  return { clipboard, handlers, ipcMain };
});

const assertTrustedSender = vi.hoisted(() => vi.fn());

vi.mock('electron', () => ({
  clipboard: electronMocks.clipboard,
  ipcMain: electronMocks.ipcMain,
}));

vi.mock('../../../src/main/ipc/security', () => ({ assertTrustedSender }));

import { ClientIpcController, type ClientBackendPort } from '../../../src/main/ipc/handler';

const createBackend = (): ClientBackendPort => ({
  acceptWritingPreference: vi.fn(),
  addDictionaryEntry: vi.fn(),
  acknowledgeDiagnostics: vi.fn(),
  checkForUpdates: vi.fn(),
  clearDiagnostics: vi.fn(),
  clearHistory: vi.fn(),
  clearPersonalizationMemory: vi.fn(),
  applyBackup: vi.fn(),
  createBackup: vi.fn(),
  deleteBackup: vi.fn(),
  downloadUpdate: vi.fn(),
  exportDiagnostics: vi.fn(),
  generateBackupCode: vi.fn(),
  getClientSnapshot: vi.fn(() => Promise.resolve({} as ClientSnapshot)),
  getDiagnostics: vi.fn(),
  getSyncConfig: vi.fn(),
  getUsageStats: vi.fn(),
  installUpdate: vi.fn(),
  listHistory: vi.fn(),
  listMicrophones: vi.fn(),
  listRemoteBackups: vi.fn(),
  requestAccessibilityAccess: vi.fn(),
  removeProvider: vi.fn(),
  removeDictionaryEntry: vi.fn(),
  removeWritingPreference: vi.fn(),
  rejectWritingPreference: vi.fn(),
  reportRendererIssue: vi.fn(),
  setHotkeyCaptureActive: vi.fn(),
  setDictionaryLearningEnabled: vi.fn(),
  setApplicationWritingStyle: vi.fn(),
  setProfile: vi.fn(),
  setPersonalizationLearningEnabled: vi.fn(),
  testProvider: vi.fn(),
  testSyncConnection: vi.fn(),
  updateSettings: vi.fn(),
  updateSyncConfig: vi.fn(),
  upsertProvider: vi.fn(),
});

describe('ClientIpcController', () => {
  beforeEach(() => {
    electronMocks.clipboard.writeText.mockClear();
    electronMocks.handlers.clear();
    electronMocks.ipcMain.handle.mockClear();
    electronMocks.ipcMain.removeHandler.mockClear();
    assertTrustedSender.mockClear();
  });

  it('copies trusted renderer text through Electron clipboard', async () => {
    const controller = new ClientIpcController(createBackend());
    const handler = electronMocks.handlers.get(IPC_CHANNELS.copyText);

    await handler?.({}, 'Copied history record');

    expect(assertTrustedSender).toHaveBeenCalledOnce();
    expect(electronMocks.clipboard.writeText).toHaveBeenCalledWith('Copied history record');
    controller.destroy();
  });

  it('routes atomic dictionary operations through trusted IPC handlers', () => {
    const backend = createBackend();
    const controller = new ClientIpcController(backend);

    electronMocks.handlers.get(IPC_CHANNELS.addDictionaryEntry)?.({}, 'UnTypo');
    electronMocks.handlers.get(IPC_CHANNELS.removeDictionaryEntry)?.({}, 'UnTypo');
    electronMocks.handlers.get(IPC_CHANNELS.setDictionaryLearningEnabled)?.({}, false);
    electronMocks.handlers.get(IPC_CHANNELS.setApplicationWritingStyle)?.(
      {},
      { application: 'office', style: 'formal' },
    );
    electronMocks.handlers.get(IPC_CHANNELS.setPersonalizationLearningEnabled)?.({}, true);
    const preferenceId = '1234567890abcdef12345678';
    electronMocks.handlers.get(IPC_CHANNELS.acceptWritingPreference)?.({}, preferenceId);
    electronMocks.handlers.get(IPC_CHANNELS.rejectWritingPreference)?.({}, preferenceId);
    electronMocks.handlers.get(IPC_CHANNELS.removeWritingPreference)?.({}, preferenceId);
    electronMocks.handlers.get(IPC_CHANNELS.clearPersonalizationMemory)?.({});

    expect(backend.addDictionaryEntry).toHaveBeenCalledWith('UnTypo');
    expect(backend.removeDictionaryEntry).toHaveBeenCalledWith('UnTypo');
    expect(backend.setDictionaryLearningEnabled).toHaveBeenCalledWith(false);
    expect(backend.setApplicationWritingStyle).toHaveBeenCalledWith({
      application: 'office',
      style: 'formal',
    });
    expect(backend.setPersonalizationLearningEnabled).toHaveBeenCalledWith(true);
    expect(backend.acceptWritingPreference).toHaveBeenCalledWith(preferenceId);
    expect(backend.rejectWritingPreference).toHaveBeenCalledWith(preferenceId);
    expect(backend.removeWritingPreference).toHaveBeenCalledWith(preferenceId);
    expect(backend.clearPersonalizationMemory).toHaveBeenCalledOnce();
    controller.destroy();
  });

  it('clears diagnostic records through a trusted IPC handler', () => {
    const backend = createBackend();
    const controller = new ClientIpcController(backend);

    electronMocks.handlers.get(IPC_CHANNELS.clearDiagnostics)?.({});

    expect(assertTrustedSender).toHaveBeenCalledOnce();
    expect(backend.clearDiagnostics).toHaveBeenCalledOnce();
    controller.destroy();
  });

  it('routes backup actions through trusted and validated IPC handlers', async () => {
    const backend = createBackend();
    vi.mocked(backend.deleteBackup).mockResolvedValue({ ok: true });
    const controller = new ClientIpcController(backend);
    const event = {};

    await electronMocks.handlers.get(IPC_CHANNELS.applyBackup)?.(event, 'untypo/backup.untypo');
    await electronMocks.handlers.get(IPC_CHANNELS.deleteBackup)?.(event, 'untypo/backup.untypo');
    await electronMocks.handlers.get(IPC_CHANNELS.createBackup)?.(event);

    expect(backend.applyBackup).toHaveBeenCalledWith('untypo/backup.untypo');
    expect(backend.deleteBackup).toHaveBeenCalledWith('untypo/backup.untypo');
    expect(backend.createBackup).toHaveBeenCalledOnce();
    expect(assertTrustedSender).toHaveBeenCalledTimes(3);
    controller.destroy();
  });

  it('forwards the sender when toggling hotkey capture', async () => {
    const backend = createBackend();
    const controller = new ClientIpcController(backend);
    const handler = electronMocks.handlers.get(IPC_CHANNELS.setHotkeyCaptureActive);
    const sender = { id: 7 };

    await handler?.({ sender }, true);

    expect(assertTrustedSender).toHaveBeenCalledOnce();
    expect(backend.setHotkeyCaptureActive).toHaveBeenCalledWith(true, sender);
    controller.destroy();
  });

  it('removes exactly the channels it registered on destroy', () => {
    const controller = new ClientIpcController(createBackend());
    const registered = electronMocks.ipcMain.handle.mock.calls.map(([channel]) => channel).sort();

    controller.destroy();

    const removed = electronMocks.ipcMain.removeHandler.mock.calls
      .map(([channel]) => channel)
      .sort();
    expect(registered).toEqual(removed);
    expect(new Set(registered).size).toBe(registered.length);
  });

  it('covers every renderer-invokable client channel', () => {
    new ClientIpcController(createBackend()).destroy();

    const registered = new Set(electronMocks.ipcMain.handle.mock.calls.map(([channel]) => channel));
    const mainToRendererOnly = new Set([
      IPC_CHANNELS.hotkeyCaptureEvent,
      IPC_CHANNELS.ping,
      IPC_CHANNELS.snapshotChanged,
      IPC_CHANNELS.updateChanged,
    ]);
    for (const channel of Object.values(IPC_CHANNELS)) {
      if (mainToRendererOnly.has(channel)) {
        expect(registered.has(channel)).toBe(false);
        continue;
      }
      expect(registered.has(channel)).toBe(true);
    }
  });
});
