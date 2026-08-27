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
  addDictionaryEntry: vi.fn(),
  acknowledgeDiagnostics: vi.fn(),
  checkForUpdates: vi.fn(),
  clearHistory: vi.fn(),
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
  reportRendererIssue: vi.fn(),
  setDictionaryLearningEnabled: vi.fn(),
  setProfile: vi.fn(),
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

    expect(backend.addDictionaryEntry).toHaveBeenCalledWith('UnTypo');
    expect(backend.removeDictionaryEntry).toHaveBeenCalledWith('UnTypo');
    expect(backend.setDictionaryLearningEnabled).toHaveBeenCalledWith(false);
    controller.destroy();
  });
});
