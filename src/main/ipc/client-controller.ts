import { clipboard, ipcMain, type IpcMainInvokeEvent } from 'electron';
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
import { assertTrustedSender } from '../security.js';
import {
  parseDiagnosticExportRequest,
  parseDiagnosticIssueIds,
  parseRendererIssue,
} from './diagnostic-validation.js';
import {
  parseClipboardText,
  parseDictionaryLearningEnabled,
  parseDictionaryTerm,
  parseHistoryQuery,
  parseProfile,
  parseProfileId,
  parseProviderInput,
  parseSettingsUpdate,
} from './validation.js';

export interface ClientBackendPort {
  addDictionaryEntry: (term: string) => Promise<ClientSnapshot>;
  acknowledgeDiagnostics: (
    issueIds: readonly string[],
  ) => ClientDiagnosticSnapshot;
  clearHistory: () => number;
  checkForUpdates: () => Promise<ClientUpdateSnapshot>;
  downloadUpdate: () => Promise<ClientUpdateSnapshot>;
  exportDiagnostics: (
    request: ClientDiagnosticExportRequest,
  ) => Promise<ClientDiagnosticExportResult>;
  getDiagnostics: () => ClientDiagnosticSnapshot;
  getClientSnapshot: () => Promise<ClientSnapshot>;
  getUsageStats: () => ClientUsageStats;
  installUpdate: () => void;
  listHistory: (query: ClientHistoryQuery) => readonly ClientHistoryRecord[];
  listMicrophones: () => Promise<readonly ClientMicrophoneDevice[]>;
  removeProvider: (profileId: string) => Promise<ClientSnapshot>;
  removeDictionaryEntry: (term: string) => Promise<ClientSnapshot>;
  reportRendererIssue: (issue: ClientRendererIssueInput) => void;
  setDictionaryLearningEnabled: (enabled: boolean) => Promise<ClientSnapshot>;
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
    ipcMain.handle(IPC_CHANNELS.addDictionaryEntry, this.addDictionaryEntry);
    ipcMain.handle(
      IPC_CHANNELS.acknowledgeDiagnostics,
      this.acknowledgeDiagnostics,
    );
    ipcMain.handle(IPC_CHANNELS.exportDiagnostics, this.exportDiagnostics);
    ipcMain.handle(IPC_CHANNELS.getDiagnostics, this.getDiagnostics);
    ipcMain.handle(IPC_CHANNELS.getSnapshot, this.getSnapshot);
    ipcMain.handle(IPC_CHANNELS.getUsageStats, this.getUsageStats);
    ipcMain.handle(IPC_CHANNELS.listMicrophones, this.listMicrophones);
    ipcMain.handle(IPC_CHANNELS.updateSettings, this.updateSettings);
    ipcMain.handle(
      IPC_CHANNELS.removeDictionaryEntry,
      this.removeDictionaryEntry,
    );
    ipcMain.handle(
      IPC_CHANNELS.setDictionaryLearningEnabled,
      this.setDictionaryLearningEnabled,
    );
    ipcMain.handle(IPC_CHANNELS.setProfile, this.setProfile);
    ipcMain.handle(IPC_CHANNELS.upsertProvider, this.upsertProvider);
    ipcMain.handle(IPC_CHANNELS.removeProvider, this.removeProvider);
    ipcMain.handle(IPC_CHANNELS.reportRendererIssue, this.reportRendererIssue);
    ipcMain.handle(IPC_CHANNELS.testProvider, this.testProvider);
    ipcMain.handle(IPC_CHANNELS.listHistory, this.listHistory);
    ipcMain.handle(IPC_CHANNELS.clearHistory, this.clearHistory);
    ipcMain.handle(IPC_CHANNELS.checkForUpdates, this.checkForUpdates);
    ipcMain.handle(IPC_CHANNELS.copyText, this.copyText);
    ipcMain.handle(IPC_CHANNELS.downloadUpdate, this.downloadUpdate);
    ipcMain.handle(IPC_CHANNELS.installUpdate, this.installUpdate);
  }

  destroy(): void {
    for (const channel of [
      IPC_CHANNELS.addDictionaryEntry,
      IPC_CHANNELS.acknowledgeDiagnostics,
      IPC_CHANNELS.exportDiagnostics,
      IPC_CHANNELS.getDiagnostics,
      IPC_CHANNELS.getSnapshot,
      IPC_CHANNELS.getUsageStats,
      IPC_CHANNELS.listMicrophones,
      IPC_CHANNELS.updateSettings,
      IPC_CHANNELS.removeDictionaryEntry,
      IPC_CHANNELS.setDictionaryLearningEnabled,
      IPC_CHANNELS.setProfile,
      IPC_CHANNELS.upsertProvider,
      IPC_CHANNELS.removeProvider,
      IPC_CHANNELS.reportRendererIssue,
      IPC_CHANNELS.testProvider,
      IPC_CHANNELS.listHistory,
      IPC_CHANNELS.clearHistory,
      IPC_CHANNELS.checkForUpdates,
      IPC_CHANNELS.copyText,
      IPC_CHANNELS.downloadUpdate,
      IPC_CHANNELS.installUpdate,
    ]) {
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

  private readonly acknowledgeDiagnostics = (
    event: IpcMainInvokeEvent,
    value: unknown,
  ): ClientDiagnosticSnapshot => {
    trust(event);
    return this.#backend.acknowledgeDiagnostics(parseDiagnosticIssueIds(value));
  };

  private readonly getSnapshot = (
    event: IpcMainInvokeEvent,
  ): Promise<ClientSnapshot> => {
    trust(event);
    return this.#backend.getClientSnapshot();
  };

  private readonly getUsageStats = (
    event: IpcMainInvokeEvent,
  ): ClientUsageStats => {
    trust(event);
    return this.#backend.getUsageStats();
  };

  private readonly listMicrophones = (
    event: IpcMainInvokeEvent,
  ): Promise<readonly ClientMicrophoneDevice[]> => {
    trust(event);
    return this.#backend.listMicrophones();
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

  private readonly setDictionaryLearningEnabled = (
    event: IpcMainInvokeEvent,
    value: unknown,
  ): Promise<ClientSnapshot> => {
    trust(event);
    return this.#backend.setDictionaryLearningEnabled(
      parseDictionaryLearningEnabled(value),
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

  private readonly checkForUpdates = (
    event: IpcMainInvokeEvent,
  ): Promise<ClientUpdateSnapshot> => {
    trust(event);
    return this.#backend.checkForUpdates();
  };

  private readonly downloadUpdate = (
    event: IpcMainInvokeEvent,
  ): Promise<ClientUpdateSnapshot> => {
    trust(event);
    return this.#backend.downloadUpdate();
  };

  private readonly installUpdate = (event: IpcMainInvokeEvent): void => {
    trust(event);
    this.#backend.installUpdate();
  };

  private readonly copyText = (
    event: IpcMainInvokeEvent,
    value: unknown,
  ): void => {
    trust(event);
    clipboard.writeText(parseClipboardText(value));
  };

  private readonly exportDiagnostics = (
    event: IpcMainInvokeEvent,
    value: unknown,
  ): Promise<ClientDiagnosticExportResult> => {
    trust(event);
    return this.#backend.exportDiagnostics(parseDiagnosticExportRequest(value));
  };

  private readonly getDiagnostics = (
    event: IpcMainInvokeEvent,
  ): ClientDiagnosticSnapshot => {
    trust(event);
    return this.#backend.getDiagnostics();
  };

  private readonly reportRendererIssue = (
    event: IpcMainInvokeEvent,
    value: unknown,
  ): void => {
    trust(event);
    this.#backend.reportRendererIssue(parseRendererIssue(value));
  };
}
