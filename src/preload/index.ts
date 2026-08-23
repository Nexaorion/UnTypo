import { contextBridge, ipcRenderer } from 'electron';
import type {
  ClientHistoryQuery,
  ClientProviderInput,
  ClientSettingsUpdate,
  ClientSnapshot,
  PingResponse,
  UntypoApi,
} from '../shared/ipc.js';

const PING_CHANNEL = 'app:ping';
const channels = {
  clearHistory: 'client:clear-history',
  getSnapshot: 'client:get-snapshot',
  listHistory: 'client:list-history',
  removeProvider: 'client:remove-provider',
  setDictionary: 'client:set-dictionary',
  setProfile: 'client:set-profile',
  testProvider: 'client:test-provider',
  updateSettings: 'client:update-settings',
  upsertProvider: 'client:upsert-provider',
} as const;

const api: UntypoApi = {
  clearHistory: () =>
    ipcRenderer.invoke(channels.clearHistory) as Promise<number>,
  getSnapshot: () =>
    ipcRenderer.invoke(channels.getSnapshot) as Promise<ClientSnapshot>,
  listHistory: (query?: ClientHistoryQuery) =>
    ipcRenderer.invoke(channels.listHistory, query) as ReturnType<
      UntypoApi['listHistory']
    >,
  ping: () => ipcRenderer.invoke(PING_CHANNEL) as Promise<PingResponse>,
  removeProvider: (profileId: string) =>
    ipcRenderer.invoke(
      channels.removeProvider,
      profileId,
    ) as Promise<ClientSnapshot>,
  setDictionary: (entries: readonly string[]) =>
    ipcRenderer.invoke(
      channels.setDictionary,
      entries,
    ) as Promise<ClientSnapshot>,
  setProfile: (profile) =>
    ipcRenderer.invoke(channels.setProfile, profile) as Promise<ClientSnapshot>,
  testProvider: (profileId: string) =>
    ipcRenderer.invoke(channels.testProvider, profileId) as Promise<{
      ok: true;
    }>,
  updateSettings: (update: ClientSettingsUpdate) =>
    ipcRenderer.invoke(
      channels.updateSettings,
      update,
    ) as Promise<ClientSnapshot>,
  upsertProvider: (profile: ClientProviderInput) =>
    ipcRenderer.invoke(
      channels.upsertProvider,
      profile,
    ) as Promise<ClientSnapshot>,
};

contextBridge.exposeInMainWorld('untypo', api);
