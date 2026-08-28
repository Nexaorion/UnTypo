import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientSnapshot } from '../../src/shared/ipc';
import { IPC_CHANNELS } from '../../src/shared/ipc';

const electronMocks = vi.hoisted(() => {
  const handlers = new Map<string, (...arguments_: unknown[]) => unknown>();
  const clipboard = { writeText: vi.fn() };
  const ipcMain = {
    handle: vi.fn(
      (channel: string, handler: (...arguments_: unknown[]) => unknown) => {
        handlers.set(channel, handler);
      },
    ),
    removeHandler: vi.fn(),
  };
  return { clipboard, handlers, ipcMain };
});

const assertTrustedSender = vi.hoisted(() => vi.fn());

vi.mock('electron', () => ({
  clipboard: electronMocks.clipboard,
  ipcMain: electronMocks.ipcMain,
}));

vi.mock('../../src/main/security', () => ({ assertTrustedSender }));

import {
  ClientIpcController,
  type ClientBackendPort,
} from '../../src/main/ipc/client-controller';

const createBackend = (): ClientBackendPort => ({
  acceptWritingPreference: vi.fn(),
  addDictionaryEntry: vi.fn(),
  acknowledgeDiagnostics: vi.fn(),
  checkForUpdates: vi.fn(),
  clearDiagnostics: vi.fn(),
  clearHistory: vi.fn(),
  clearPersonalizationMemory: vi.fn(),
  downloadUpdate: vi.fn(),
  exportDiagnostics: vi.fn(),
  getClientSnapshot: vi.fn(() => Promise.resolve({} as ClientSnapshot)),
  getDiagnostics: vi.fn(),
  getUsageStats: vi.fn(),
  installUpdate: vi.fn(),
  listHistory: vi.fn(),
  listMicrophones: vi.fn(),
  removeProvider: vi.fn(),
  removeDictionaryEntry: vi.fn(),
  removeWritingPreference: vi.fn(),
  rejectWritingPreference: vi.fn(),
  reportRendererIssue: vi.fn(),
  setDictionaryLearningEnabled: vi.fn(),
  setApplicationWritingStyle: vi.fn(),
  setProfile: vi.fn(),
  setPersonalizationLearningEnabled: vi.fn(),
  testProvider: vi.fn(),
  updateSettings: vi.fn(),
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

  it('copies trusted renderer text through Electron clipboard', () => {
    const controller = new ClientIpcController(createBackend());
    const handler = electronMocks.handlers.get(IPC_CHANNELS.copyText);

    handler?.({}, 'Copied history record');

    expect(assertTrustedSender).toHaveBeenCalledOnce();
    expect(electronMocks.clipboard.writeText).toHaveBeenCalledWith(
      'Copied history record',
    );
    controller.destroy();
  });

  it('routes atomic dictionary operations through trusted IPC handlers', () => {
    const backend = createBackend();
    const controller = new ClientIpcController(backend);

    electronMocks.handlers.get(IPC_CHANNELS.addDictionaryEntry)?.({}, 'UnTypo');
    electronMocks.handlers.get(IPC_CHANNELS.removeDictionaryEntry)?.(
      {},
      'UnTypo',
    );
    electronMocks.handlers.get(IPC_CHANNELS.setDictionaryLearningEnabled)?.(
      {},
      false,
    );
    electronMocks.handlers.get(IPC_CHANNELS.setApplicationWritingStyle)?.(
      {},
      { application: 'office', style: 'formal' },
    );
    electronMocks.handlers.get(
      IPC_CHANNELS.setPersonalizationLearningEnabled,
    )?.({}, true);
    const preferenceId = '1234567890abcdef12345678';
    electronMocks.handlers.get(IPC_CHANNELS.acceptWritingPreference)?.(
      {},
      preferenceId,
    );
    electronMocks.handlers.get(IPC_CHANNELS.rejectWritingPreference)?.(
      {},
      preferenceId,
    );
    electronMocks.handlers.get(IPC_CHANNELS.removeWritingPreference)?.(
      {},
      preferenceId,
    );
    electronMocks.handlers.get(IPC_CHANNELS.clearPersonalizationMemory)?.({});

    expect(backend.addDictionaryEntry).toHaveBeenCalledWith('UnTypo');
    expect(backend.removeDictionaryEntry).toHaveBeenCalledWith('UnTypo');
    expect(backend.setDictionaryLearningEnabled).toHaveBeenCalledWith(false);
    expect(backend.setApplicationWritingStyle).toHaveBeenCalledWith({
      application: 'office',
      style: 'formal',
    });
    expect(backend.setPersonalizationLearningEnabled).toHaveBeenCalledWith(
      true,
    );
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
});
