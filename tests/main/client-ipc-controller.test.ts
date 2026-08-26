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
  acknowledgeDiagnostics: vi.fn(),
  clearHistory: vi.fn(),
  exportDiagnostics: vi.fn(),
  getClientSnapshot: vi.fn(() => Promise.resolve({} as ClientSnapshot)),
  getDiagnostics: vi.fn(),
  getUsageStats: vi.fn(),
  listHistory: vi.fn(),
  listMicrophones: vi.fn(),
  removeProvider: vi.fn(),
  reportRendererIssue: vi.fn(),
  setDictionary: vi.fn(),
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
});
