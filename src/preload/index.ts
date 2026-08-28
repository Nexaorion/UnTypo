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
  ClientUpdateSnapshot,
  ClientUsageStats,
  PingResponse,
  UntypoApi,
} from '../shared/ipc.js';
import type { ClientApplicationWritingStyleUpdate } from '../shared/personalization.js';

const PING_CHANNEL = 'app:ping';
const DIAGNOSTIC_CHANGED_CHANNEL = 'client:diagnostics-changed';
const UPDATE_CHANGED_CHANNEL = 'client:update-changed';
const SNAPSHOT_CHANGED_CHANNEL = 'client:snapshot-changed';
const channels = {
  acceptWritingPreference: 'client:accept-writing-preference',
  addDictionaryEntry: 'client:add-dictionary-entry',
  acknowledgeDiagnostics: 'client:acknowledge-diagnostics',
  checkForUpdates: 'client:check-for-updates',
  clearDiagnostics: 'client:clear-diagnostics',
  clearHistory: 'client:clear-history',
  clearPersonalizationMemory: 'client:clear-personalization-memory',
  copyText: 'client:copy-text',
  downloadUpdate: 'client:download-update',
  exportDiagnostics: 'client:export-diagnostics',
  getDiagnostics: 'client:get-diagnostics',
  getSnapshot: 'client:get-snapshot',
  getUsageStats: 'client:get-usage-stats',
  installUpdate: 'client:install-update',
  listHistory: 'client:list-history',
  listMicrophones: 'client:list-microphones',
  removeProvider: 'client:remove-provider',
  removeDictionaryEntry: 'client:remove-dictionary-entry',
  removeWritingPreference: 'client:remove-writing-preference',
  rejectWritingPreference: 'client:reject-writing-preference',
  reportRendererIssue: 'client:report-renderer-issue',
  setDictionaryLearningEnabled: 'client:set-dictionary-learning-enabled',
  setApplicationWritingStyle: 'client:set-application-writing-style',
  setPersonalizationLearningEnabled:
    'client:set-personalization-learning-enabled',
  setProfile: 'client:set-profile',
  testProvider: 'client:test-provider',
  updateSettings: 'client:update-settings',
  upsertProvider: 'client:upsert-provider',
} as const;

const api: UntypoApi = {
  acceptWritingPreference: (id: string) =>
    ipcRenderer.invoke(
      channels.acceptWritingPreference,
      id,
    ) as Promise<ClientSnapshot>,
  addDictionaryEntry: (term: string) =>
    ipcRenderer.invoke(
      channels.addDictionaryEntry,
      term,
    ) as Promise<ClientSnapshot>,
  acknowledgeDiagnostics: (issueIds: readonly string[]) =>
    ipcRenderer.invoke(
      channels.acknowledgeDiagnostics,
      issueIds,
    ) as Promise<ClientDiagnosticSnapshot>,
  clearDiagnostics: () =>
    ipcRenderer.invoke(
      channels.clearDiagnostics,
    ) as Promise<ClientDiagnosticSnapshot>,
  clearHistory: () =>
    ipcRenderer.invoke(channels.clearHistory) as Promise<number>,
  clearPersonalizationMemory: () =>
    ipcRenderer.invoke(
      channels.clearPersonalizationMemory,
    ) as Promise<ClientSnapshot>,
  checkForUpdates: () =>
    ipcRenderer.invoke(
      channels.checkForUpdates,
    ) as Promise<ClientUpdateSnapshot>,
  copyText: (text: string) =>
    ipcRenderer.invoke(channels.copyText, text) as Promise<void>,
  downloadUpdate: () =>
    ipcRenderer.invoke(
      channels.downloadUpdate,
    ) as Promise<ClientUpdateSnapshot>,
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
  installUpdate: () =>
    ipcRenderer.invoke(channels.installUpdate) as Promise<void>,
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
  onSnapshotChanged: (listener: (snapshot: ClientSnapshot) => void) => {
    const handleChanged = (
      _event: Electron.IpcRendererEvent,
      snapshot: ClientSnapshot,
    ) => listener(snapshot);
    ipcRenderer.on(SNAPSHOT_CHANGED_CHANNEL, handleChanged);
    return () =>
      ipcRenderer.removeListener(SNAPSHOT_CHANGED_CHANNEL, handleChanged);
  },
  onUpdateChanged: (listener: (update: ClientUpdateSnapshot) => void) => {
    const handleChanged = (
      _event: Electron.IpcRendererEvent,
      update: ClientUpdateSnapshot,
    ) => listener(update);
    ipcRenderer.on(UPDATE_CHANGED_CHANNEL, handleChanged);
    return () =>
      ipcRenderer.removeListener(UPDATE_CHANGED_CHANNEL, handleChanged);
  },
  ping: () => ipcRenderer.invoke(PING_CHANNEL) as Promise<PingResponse>,
  removeProvider: (profileId: string) =>
    ipcRenderer.invoke(
      channels.removeProvider,
      profileId,
    ) as Promise<ClientSnapshot>,
  removeDictionaryEntry: (term: string) =>
    ipcRenderer.invoke(
      channels.removeDictionaryEntry,
      term,
    ) as Promise<ClientSnapshot>,
  removeWritingPreference: (id: string) =>
    ipcRenderer.invoke(
      channels.removeWritingPreference,
      id,
    ) as Promise<ClientSnapshot>,
  rejectWritingPreference: (id: string) =>
    ipcRenderer.invoke(
      channels.rejectWritingPreference,
      id,
    ) as Promise<ClientSnapshot>,
  reportRendererIssue: (issue: ClientRendererIssueInput) =>
    ipcRenderer.invoke(channels.reportRendererIssue, issue) as Promise<void>,
  setDictionaryLearningEnabled: (enabled: boolean) =>
    ipcRenderer.invoke(
      channels.setDictionaryLearningEnabled,
      enabled,
    ) as Promise<ClientSnapshot>,
  setApplicationWritingStyle: (update: ClientApplicationWritingStyleUpdate) =>
    ipcRenderer.invoke(
      channels.setApplicationWritingStyle,
      update,
    ) as Promise<ClientSnapshot>,
  setPersonalizationLearningEnabled: (enabled: boolean) =>
    ipcRenderer.invoke(
      channels.setPersonalizationLearningEnabled,
      enabled,
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
