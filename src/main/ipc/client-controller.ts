import { clipboard, ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';
import type { UserProfileContext } from '../../core/providers/contracts.js';
import type {
  ClientDiagnosticExportRequest,
  ClientDiagnosticExportResult,
  ClientDiagnosticSnapshot,
  ClientRendererIssueInput,
} from '../../shared/diagnostics.js';
import {
  IPC_CHANNELS,
  type ClientHistoryQuery,
  type ClientHistoryRecord,
  type ClientMicrophoneDevice,
  type ClientProviderInput,
  type ClientSettingsUpdate,
  type ClientSnapshot,
  type ClientUpdateSnapshot,
  type ClientUsageStats,
} from '../../shared/ipc.js';
import type {
  ClientSyncConfigUpdate,
  ClientSyncResult,
  ClientSyncSnapshot,
  SyncBackupInfo,
} from '../../shared/sync.js';
import type { ClientApplicationWritingStyleUpdate } from '../../shared/personalization.js';
import { assertTrustedSender } from '../security.js';
import {
  parseDiagnosticExportRequest,
  parseDiagnosticIssueIds,
  parseRendererIssue,
} from './diagnostic-validation.js';
import {
  parseApplicationWritingStyleUpdate,
  parseClipboardText,
  parseDictionaryLearningEnabled,
  parseDictionaryTerm,
  parseHistoryQuery,
  parsePersonalizationLearningEnabled,
  parseBooleanFlag,
  parseProfile,
  parseProfileId,
  parseProviderInput,
  parseRemoteBackupPath,
  parseSettingsUpdate,
  parseSyncConfigUpdate,
  parseWritingPreferenceId,
} from './validation.js';

export interface ClientBackendPort {
  acceptWritingPreference: (id: string) => Promise<ClientSnapshot>;
  addDictionaryEntry: (term: string) => Promise<ClientSnapshot>;
  acknowledgeDiagnostics: (
    issueIds: readonly string[],
  ) => ClientDiagnosticSnapshot | Promise<ClientDiagnosticSnapshot>;
  clearDiagnostics: () => ClientDiagnosticSnapshot | Promise<ClientDiagnosticSnapshot>;
  clearHistory: () => number;
  clearPersonalizationMemory: () => Promise<ClientSnapshot>;
  checkForUpdates: () => Promise<ClientUpdateSnapshot>;
  applyBackup: (remoteFile: string) => Promise<ClientSyncResult>;
  createBackup: () => Promise<ClientSyncResult>;
  deleteBackup: (remoteFile: string) => Promise<{ ok: true }>;
  downloadUpdate: () => Promise<ClientUpdateSnapshot>;
  exportDiagnostics: (
    request: ClientDiagnosticExportRequest,
  ) => Promise<ClientDiagnosticExportResult>;
  generateBackupCode: () => Promise<string>;
  getDiagnostics: () => ClientDiagnosticSnapshot;
  getClientSnapshot: () => Promise<ClientSnapshot>;
  getSyncConfig: () => Promise<ClientSyncSnapshot>;
  getUsageStats: () => ClientUsageStats;
  installUpdate: () => void;
  listHistory: (query: ClientHistoryQuery) => readonly ClientHistoryRecord[];
  listMicrophones: () => Promise<readonly ClientMicrophoneDevice[]>;
  listRemoteBackups: () => Promise<readonly SyncBackupInfo[]>;
  requestAccessibilityAccess: () => Promise<ClientSnapshot>;
  removeProvider: (profileId: string) => Promise<ClientSnapshot>;
  removeDictionaryEntry: (term: string) => Promise<ClientSnapshot>;
  removeWritingPreference: (id: string) => Promise<ClientSnapshot>;
  rejectWritingPreference: (id: string) => Promise<ClientSnapshot>;
  reportRendererIssue: (issue: ClientRendererIssueInput) => void;
  setHotkeyCaptureActive: (active: boolean, sender?: WebContents) => Promise<void>;
  setDictionaryLearningEnabled: (enabled: boolean) => Promise<ClientSnapshot>;
  setApplicationWritingStyle: (
    update: ClientApplicationWritingStyleUpdate,
  ) => Promise<ClientSnapshot>;
  setProfile: (profile?: UserProfileContext) => Promise<ClientSnapshot>;
  setPersonalizationLearningEnabled: (enabled: boolean) => Promise<ClientSnapshot>;
  testProvider: (profileId: string) => Promise<{ ok: true }>;
  testSyncConnection: () => Promise<{ ok: true }>;
  updateSettings: (update: ClientSettingsUpdate) => Promise<ClientSnapshot>;
  updateSyncConfig: (config: ClientSyncConfigUpdate) => Promise<ClientSnapshot>;
  upsertProvider: (profile: ClientProviderInput) => Promise<ClientSnapshot>;
}

const trust = (event: IpcMainInvokeEvent): void => assertTrustedSender(event);

type IpcHandlerRegistration = readonly [
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...arguments_: unknown[]) => unknown,
];

export class ClientIpcController {
  readonly #backend: ClientBackendPort;
  readonly #registrations: readonly IpcHandlerRegistration[];

  constructor(backend: ClientBackendPort) {
    this.#backend = backend;
    const registrations: readonly IpcHandlerRegistration[] = [
      [IPC_CHANNELS.acceptWritingPreference, this.acceptWritingPreference],
      [IPC_CHANNELS.addDictionaryEntry, this.addDictionaryEntry],
      [IPC_CHANNELS.acknowledgeDiagnostics, this.acknowledgeDiagnostics],
      [IPC_CHANNELS.clearDiagnostics, this.clearDiagnostics],
      [IPC_CHANNELS.clearPersonalizationMemory, this.clearPersonalizationMemory],
      [IPC_CHANNELS.exportDiagnostics, this.exportDiagnostics],
      [IPC_CHANNELS.getDiagnostics, this.getDiagnostics],
      [IPC_CHANNELS.getSnapshot, this.getSnapshot],
      [IPC_CHANNELS.getUsageStats, this.getUsageStats],
      [IPC_CHANNELS.listMicrophones, this.listMicrophones],
      [IPC_CHANNELS.requestAccessibilityAccess, this.requestAccessibilityAccess],
      [IPC_CHANNELS.updateSettings, this.updateSettings],
      [IPC_CHANNELS.removeDictionaryEntry, this.removeDictionaryEntry],
      [IPC_CHANNELS.removeWritingPreference, this.removeWritingPreference],
      [IPC_CHANNELS.rejectWritingPreference, this.rejectWritingPreference],
      [IPC_CHANNELS.setDictionaryLearningEnabled, this.setDictionaryLearningEnabled],
      [IPC_CHANNELS.setApplicationWritingStyle, this.setApplicationWritingStyle],
      [IPC_CHANNELS.setPersonalizationLearningEnabled, this.setPersonalizationLearningEnabled],
      [IPC_CHANNELS.setProfile, this.setProfile],
      [IPC_CHANNELS.upsertProvider, this.upsertProvider],
      [IPC_CHANNELS.removeProvider, this.removeProvider],
      [IPC_CHANNELS.reportRendererIssue, this.reportRendererIssue],
      [IPC_CHANNELS.setHotkeyCaptureActive, this.setHotkeyCaptureActive],
      [IPC_CHANNELS.testProvider, this.testProvider],
      [IPC_CHANNELS.listHistory, this.listHistory],
      [IPC_CHANNELS.clearHistory, this.clearHistory],
      [IPC_CHANNELS.checkForUpdates, this.checkForUpdates],
      [IPC_CHANNELS.copyText, this.copyText],
      [IPC_CHANNELS.applyBackup, this.applyBackup],
      [IPC_CHANNELS.createBackup, this.createBackup],
      [IPC_CHANNELS.deleteBackup, this.deleteBackup],
      [IPC_CHANNELS.downloadUpdate, this.downloadUpdate],
      [IPC_CHANNELS.generateBackupCode, this.generateBackupCode],
      [IPC_CHANNELS.getSyncConfig, this.getSyncConfig],
      [IPC_CHANNELS.installUpdate, this.installUpdate],
      [IPC_CHANNELS.listRemoteBackups, this.listRemoteBackups],
      [IPC_CHANNELS.testSyncConnection, this.testSyncConnection],
      [IPC_CHANNELS.updateSyncConfig, this.updateSyncConfig],
    ];
    this.#registrations = registrations;
    for (const [channel, handler] of registrations) {
      ipcMain.handle(channel, handler);
    }
  }

  destroy(): void {
    for (const [channel] of this.#registrations) {
      ipcMain.removeHandler(channel);
    }
  }

  private readonly addDictionaryEntry = (
    event: IpcMainInvokeEvent,
    value: unknown,
  ): Promise<ClientSnapshot> => {
    trust(event);
    return this.#backend.addDictionaryEntry(parseDictionaryTerm(value));
  };

  private readonly acceptWritingPreference = (
    event: IpcMainInvokeEvent,
    value: unknown,
  ): Promise<ClientSnapshot> => {
    trust(event);
    return this.#backend.acceptWritingPreference(parseWritingPreferenceId(value));
  };

  private readonly acknowledgeDiagnostics = (
    event: IpcMainInvokeEvent,
    value: unknown,
  ): ClientDiagnosticSnapshot | Promise<ClientDiagnosticSnapshot> => {
    trust(event);
    return this.#backend.acknowledgeDiagnostics(parseDiagnosticIssueIds(value));
  };

  private readonly clearDiagnostics = (
    event: IpcMainInvokeEvent,
  ): ClientDiagnosticSnapshot | Promise<ClientDiagnosticSnapshot> => {
    trust(event);
    return this.#backend.clearDiagnostics();
  };

  private readonly clearPersonalizationMemory = (
    event: IpcMainInvokeEvent,
  ): Promise<ClientSnapshot> => {
    trust(event);
    return this.#backend.clearPersonalizationMemory();
  };

  private readonly getSnapshot = (event: IpcMainInvokeEvent): Promise<ClientSnapshot> => {
    trust(event);
    return this.#backend.getClientSnapshot();
  };

  private readonly getUsageStats = (event: IpcMainInvokeEvent): ClientUsageStats => {
    trust(event);
    return this.#backend.getUsageStats();
  };

  private readonly listMicrophones = (
    event: IpcMainInvokeEvent,
  ): Promise<readonly ClientMicrophoneDevice[]> => {
    trust(event);
    return this.#backend.listMicrophones();
  };

  private readonly requestAccessibilityAccess = (
    event: IpcMainInvokeEvent,
  ): Promise<ClientSnapshot> => {
    trust(event);
    return this.#backend.requestAccessibilityAccess();
  };

  private readonly updateSettings = (
    event: IpcMainInvokeEvent,
    value: unknown,
  ): Promise<ClientSnapshot> => {
    trust(event);
    return this.#backend.updateSettings(parseSettingsUpdate(value));
  };

  private readonly removeDictionaryEntry = (
    event: IpcMainInvokeEvent,
    value: unknown,
  ): Promise<ClientSnapshot> => {
    trust(event);
    return this.#backend.removeDictionaryEntry(parseDictionaryTerm(value));
  };

  private readonly removeWritingPreference = (
    event: IpcMainInvokeEvent,
    value: unknown,
  ): Promise<ClientSnapshot> => {
    trust(event);
    return this.#backend.removeWritingPreference(parseWritingPreferenceId(value));
  };

  private readonly rejectWritingPreference = (
    event: IpcMainInvokeEvent,
    value: unknown,
  ): Promise<ClientSnapshot> => {
    trust(event);
    return this.#backend.rejectWritingPreference(parseWritingPreferenceId(value));
  };

  private readonly setHotkeyCaptureActive = (
    event: IpcMainInvokeEvent,
    value: unknown,
  ): Promise<void> => {
    trust(event);
    return this.#backend.setHotkeyCaptureActive(
      parseBooleanFlag(value, 'Hotkey capture'),
      event.sender,
    );
  };

  private readonly setDictionaryLearningEnabled = (
    event: IpcMainInvokeEvent,
    value: unknown,
  ): Promise<ClientSnapshot> => {
    trust(event);
    return this.#backend.setDictionaryLearningEnabled(parseDictionaryLearningEnabled(value));
  };

  private readonly setApplicationWritingStyle = (
    event: IpcMainInvokeEvent,
    value: unknown,
  ): Promise<ClientSnapshot> => {
    trust(event);
    return this.#backend.setApplicationWritingStyle(parseApplicationWritingStyleUpdate(value));
  };

  private readonly setPersonalizationLearningEnabled = (
    event: IpcMainInvokeEvent,
    value: unknown,
  ): Promise<ClientSnapshot> => {
    trust(event);
    return this.#backend.setPersonalizationLearningEnabled(
      parsePersonalizationLearningEnabled(value),
    );
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

  private readonly checkForUpdates = (event: IpcMainInvokeEvent): Promise<ClientUpdateSnapshot> => {
    trust(event);
    return this.#backend.checkForUpdates();
  };

  private readonly downloadUpdate = (event: IpcMainInvokeEvent): Promise<ClientUpdateSnapshot> => {
    trust(event);
    return this.#backend.downloadUpdate();
  };

  private readonly installUpdate = (event: IpcMainInvokeEvent): void => {
    trust(event);
    this.#backend.installUpdate();
  };

  private readonly copyText = (event: IpcMainInvokeEvent, value: unknown): Promise<void> => {
    trust(event);
    return clipboard.writeText(parseClipboardText(value));
  };

  private readonly exportDiagnostics = (
    event: IpcMainInvokeEvent,
    value: unknown,
  ): Promise<ClientDiagnosticExportResult> => {
    trust(event);
    return this.#backend.exportDiagnostics(parseDiagnosticExportRequest(value));
  };

  private readonly getDiagnostics = (event: IpcMainInvokeEvent): ClientDiagnosticSnapshot => {
    trust(event);
    return this.#backend.getDiagnostics();
  };

  private readonly reportRendererIssue = (event: IpcMainInvokeEvent, value: unknown): void => {
    trust(event);
    this.#backend.reportRendererIssue(parseRendererIssue(value));
  };

  private readonly getSyncConfig = (event: IpcMainInvokeEvent): Promise<ClientSyncSnapshot> => {
    trust(event);
    return this.#backend.getSyncConfig();
  };

  private readonly updateSyncConfig = (
    event: IpcMainInvokeEvent,
    value: unknown,
  ): Promise<ClientSnapshot> => {
    trust(event);
    return this.#backend.updateSyncConfig(parseSyncConfigUpdate(value));
  };

  private readonly testSyncConnection = (event: IpcMainInvokeEvent): Promise<{ ok: true }> => {
    trust(event);
    return this.#backend.testSyncConnection();
  };

  private readonly createBackup = (event: IpcMainInvokeEvent): Promise<ClientSyncResult> => {
    trust(event);
    return this.#backend.createBackup();
  };

  private readonly listRemoteBackups = (
    event: IpcMainInvokeEvent,
  ): Promise<readonly SyncBackupInfo[]> => {
    trust(event);
    return this.#backend.listRemoteBackups();
  };

  private readonly applyBackup = (
    event: IpcMainInvokeEvent,
    value: unknown,
  ): Promise<ClientSyncResult> => {
    trust(event);
    return this.#backend.applyBackup(parseRemoteBackupPath(value));
  };

  private readonly deleteBackup = (
    event: IpcMainInvokeEvent,
    value: unknown,
  ): Promise<{ ok: true }> => {
    trust(event);
    return this.#backend.deleteBackup(parseRemoteBackupPath(value));
  };

  private readonly generateBackupCode = (event: IpcMainInvokeEvent): Promise<string> => {
    trust(event);
    return this.#backend.generateBackupCode();
  };
}
