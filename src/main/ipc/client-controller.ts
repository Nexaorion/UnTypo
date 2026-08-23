import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import type { UserProfileContext } from '../../core/providers/contracts.js';
import {
  IPC_CHANNELS,
  type ClientHistoryQuery,
  type ClientHistoryRecord,
  type ClientProviderInput,
  type ClientSettingsUpdate,
  type ClientSnapshot,
} from '../../shared/ipc.js';
import { assertTrustedSender } from '../security.js';
import {
  parseDictionary,
  parseHistoryQuery,
  parseProfile,
  parseProfileId,
  parseProviderInput,
  parseSettingsUpdate,
} from './validation.js';

export interface ClientBackendPort {
  clearHistory: () => number;
  getClientSnapshot: () => Promise<ClientSnapshot>;
  listHistory: (query: ClientHistoryQuery) => readonly ClientHistoryRecord[];
  removeProvider: (profileId: string) => Promise<ClientSnapshot>;
  setDictionary: (entries: readonly string[]) => Promise<ClientSnapshot>;
  setProfile: (profile?: UserProfileContext) => Promise<ClientSnapshot>;
  testProvider: (profileId: string) => Promise<{ ok: true }>;
  updateSettings: (update: ClientSettingsUpdate) => Promise<ClientSnapshot>;
  upsertProvider: (profile: ClientProviderInput) => Promise<ClientSnapshot>;
}

const trust = (event: IpcMainInvokeEvent): void => assertTrustedSender(event);

export class ClientIpcController {
  readonly #backend: ClientBackendPort;

  constructor(backend: ClientBackendPort) {
    this.#backend = backend;
    ipcMain.handle(IPC_CHANNELS.getSnapshot, this.getSnapshot);
    ipcMain.handle(IPC_CHANNELS.updateSettings, this.updateSettings);
    ipcMain.handle(IPC_CHANNELS.setDictionary, this.setDictionary);
    ipcMain.handle(IPC_CHANNELS.setProfile, this.setProfile);
    ipcMain.handle(IPC_CHANNELS.upsertProvider, this.upsertProvider);
    ipcMain.handle(IPC_CHANNELS.removeProvider, this.removeProvider);
    ipcMain.handle(IPC_CHANNELS.testProvider, this.testProvider);
    ipcMain.handle(IPC_CHANNELS.listHistory, this.listHistory);
    ipcMain.handle(IPC_CHANNELS.clearHistory, this.clearHistory);
  }

  destroy(): void {
    for (const channel of [
      IPC_CHANNELS.getSnapshot,
      IPC_CHANNELS.updateSettings,
      IPC_CHANNELS.setDictionary,
      IPC_CHANNELS.setProfile,
      IPC_CHANNELS.upsertProvider,
      IPC_CHANNELS.removeProvider,
      IPC_CHANNELS.testProvider,
      IPC_CHANNELS.listHistory,
      IPC_CHANNELS.clearHistory,
    ]) {
      ipcMain.removeHandler(channel);
    }
  }

  private readonly getSnapshot = (
    event: IpcMainInvokeEvent,
  ): Promise<ClientSnapshot> => {
    trust(event);
    return this.#backend.getClientSnapshot();
  };

  private readonly updateSettings = (
    event: IpcMainInvokeEvent,
    value: unknown,
  ): Promise<ClientSnapshot> => {
    trust(event);
    return this.#backend.updateSettings(parseSettingsUpdate(value));
  };

  private readonly setDictionary = (
    event: IpcMainInvokeEvent,
    value: unknown,
  ): Promise<ClientSnapshot> => {
    trust(event);
    return this.#backend.setDictionary(parseDictionary(value));
  };

  private readonly setProfile = (
    event: IpcMainInvokeEvent,
    value: unknown,
  ): Promise<ClientSnapshot> => {
    trust(event);
    return this.#backend.setProfile(parseProfile(value));
  };

  private readonly upsertProvider = (
    event: IpcMainInvokeEvent,
    value: unknown,
  ): Promise<ClientSnapshot> => {
    trust(event);
    return this.#backend.upsertProvider(parseProviderInput(value));
  };

  private readonly removeProvider = (
    event: IpcMainInvokeEvent,
    value: unknown,
  ): Promise<ClientSnapshot> => {
    trust(event);
    return this.#backend.removeProvider(parseProfileId(value));
  };

  private readonly testProvider = (
    event: IpcMainInvokeEvent,
    value: unknown,
  ): Promise<{ ok: true }> => {
    trust(event);
    return this.#backend.testProvider(parseProfileId(value));
  };

  private readonly listHistory = (
    event: IpcMainInvokeEvent,
    value: unknown,
  ): readonly ClientHistoryRecord[] => {
    trust(event);
    return this.#backend.listHistory(parseHistoryQuery(value));
  };

  private readonly clearHistory = (event: IpcMainInvokeEvent): number => {
    trust(event);
    return this.#backend.clearHistory();
  };
}
