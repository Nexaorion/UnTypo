import { contextBridge, ipcRenderer } from 'electron';
import type {
  ClientDiagnosticExportRequest,
  ClientDiagnosticExportResult,
  ClientDiagnosticSnapshot,
  ClientRendererIssueInput,
} from '../shared/diagnostics.js';
import type {
  ClientHistoryQuery,
  ClientMicrophoneDevice,
  ClientProviderInput,
  ClientSettingsUpdate,
  ClientSnapshot,
  ClientUsageStats,
  PingResponse,
  UntypoApi,
} from '../shared/ipc.js';

const PING_CHANNEL = 'app:ping';
const DIAGNOSTIC_CHANGED_CHANNEL = 'client:diagnostics-changed';
const channels = {
  acknowledgeDiagnostics: 'client:acknowledge-diagnostics',
  clearHistory: 'client:clear-history',
  exportDiagnostics: 'client:export-diagnostics',
  getDiagnostics: 'client:get-diagnostics',
  getSnapshot: 'client:get-snapshot',
  getUsageStats: 'client:get-usage-stats',
  listHistory: 'client:list-history',
  listMicrophones: 'client:list-microphones',
  removeProvider: 'client:remove-provider',
  reportRendererIssue: 'client:report-renderer-issue',
  setDictionary: 'client:set-dictionary',
  setProfile: 'client:set-profile',
  testProvider: 'client:test-provider',
  updateSettings: 'client:update-settings',
  upsertProvider: 'client:upsert-provider',
} as const;

const api: UntypoApi = {
  acknowledgeDiagnostics: (issueIds: readonly string[]) =>
    ipcRenderer.invoke(
      channels.acknowledgeDiagnostics,
      issueIds,
    ) as Promise<ClientDiagnosticSnapshot>,
  clearHistory: () =>
    ipcRenderer.invoke(channels.clearHistory) as Promise<number>,
  exportDiagnostics: (request: ClientDiagnosticExportRequest) =>
    ipcRenderer.invoke(
      channels.exportDiagnostics,
      request,
    ) as Promise<ClientDiagnosticExportResult>,
  getDiagnostics: () =>
    ipcRenderer.invoke(
      channels.getDiagnostics,
    ) as Promise<ClientDiagnosticSnapshot>,
  getSnapshot: () =>
    ipcRenderer.invoke(channels.getSnapshot) as Promise<ClientSnapshot>,
  getUsageStats: () =>
    ipcRenderer.invoke(channels.getUsageStats) as Promise<ClientUsageStats>,
  listHistory: (query?: ClientHistoryQuery) =>
    ipcRenderer.invoke(channels.listHistory, query) as ReturnType<
      UntypoApi['listHistory']
    >,
  listMicrophones: () =>
    ipcRenderer.invoke(channels.listMicrophones) as Promise<
      readonly ClientMicrophoneDevice[]
    >,
  onDiagnosticsChanged: (listener: () => void) => {
    const handleChanged = () => listener();
    ipcRenderer.on(DIAGNOSTIC_CHANGED_CHANNEL, handleChanged);
    return () =>
      ipcRenderer.removeListener(DIAGNOSTIC_CHANGED_CHANNEL, handleChanged);
  },
  ping: () => ipcRenderer.invoke(PING_CHANNEL) as Promise<PingResponse>,
  removeProvider: (profileId: string) =>
    ipcRenderer.invoke(
      channels.removeProvider,
      profileId,
    ) as Promise<ClientSnapshot>,
  reportRendererIssue: (issue: ClientRendererIssueInput) =>
    ipcRenderer.invoke(channels.reportRendererIssue, issue) as Promise<void>,
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
