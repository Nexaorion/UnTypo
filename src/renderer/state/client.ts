import { useCallback, useEffect, useRef, useState } from 'react';
import type { UserProfileContext } from '../../core/providers/contracts.js';
import type {
  ClientDiagnosticExportRequest,
  ClientDiagnosticExportResult,
  ClientDiagnosticSnapshot,
} from '../../shared/diagnostics.js';
import type {
  ClientHistoryRecord,
  ClientMicrophoneDevice,
  ClientProviderInput,
  ClientSettingsUpdate,
  ClientSnapshot,
  ClientUsageStats,
  PingResponse,
  UntypoApi,
} from '../../shared/ipc.js';
import type { ClientApplicationWritingStyleUpdate } from '../../shared/personalization.js';
import { HISTORY_PAGE_SIZE, mergeHistoryPage } from '../logic/history.js';

export const describeError = (error: unknown): string | undefined =>
  error instanceof Error && error.message.length > 0
    ? error.message
    : undefined;

const requireApi = (): UntypoApi => {
  const api = window.untypo;
  if (!api) throw new Error('Desktop bridge unavailable');
  return api;
};

export interface ClientStore {
  acceptWritingPreference: (id: string) => Promise<void>;
  addDictionaryEntry: (term: string) => Promise<void>;
  acknowledgeDiagnostics: (issueIds: readonly string[]) => Promise<void>;
  checkForUpdates: () => Promise<void>;
  clearDiagnostics: () => Promise<void>;
  clearHistory: () => Promise<void>;
  clearPersonalizationMemory: () => Promise<void>;
  copyText: (text: string) => Promise<void>;
  diagnostics: ClientDiagnosticSnapshot | null;
  downloadUpdate: () => Promise<void>;
  exportDiagnostics: (
    request: ClientDiagnosticExportRequest,
  ) => Promise<ClientDiagnosticExportResult>;
  history: readonly ClientHistoryRecord[];
  historyExhausted: boolean;
  installUpdate: () => Promise<void>;
  loadMoreHistory: () => Promise<void>;
  listMicrophones: () => Promise<readonly ClientMicrophoneDevice[]>;
  reloadDiagnostics: () => Promise<void>;
  reloadHistory: () => Promise<void>;
  removeProvider: (profileId: string) => Promise<void>;
  removeDictionaryEntry: (term: string) => Promise<void>;
  removeWritingPreference: (id: string) => Promise<void>;
  rejectWritingPreference: (id: string) => Promise<void>;
  runtime: PingResponse | null;
  usage: ClientUsageStats | null;
  setDictionaryLearningEnabled: (enabled: boolean) => Promise<void>;
  setApplicationWritingStyle: (
    update: ClientApplicationWritingStyleUpdate,
  ) => Promise<void>;
  setProfile: (profile?: UserProfileContext) => Promise<void>;
  setPersonalizationLearningEnabled: (enabled: boolean) => Promise<void>;
  snapshot: ClientSnapshot | null;
  testProvider: (profileId: string) => Promise<void>;
  updateSettings: (update: ClientSettingsUpdate) => Promise<void>;
  upsertProvider: (profile: ClientProviderInput) => Promise<void>;
}

export const useClientStore = (): ClientStore => {
  const [snapshot, setSnapshot] = useState<ClientSnapshot | null>(null);
  const [diagnostics, setDiagnostics] =
    useState<ClientDiagnosticSnapshot | null>(null);
  const [runtime, setRuntime] = useState<PingResponse | null>(null);
  const [history, setHistory] = useState<readonly ClientHistoryRecord[]>([]);
  const [historyExhausted, setHistoryExhausted] = useState(false);
  const [usage, setUsage] = useState<ClientUsageStats | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const api = window.untypo;
    if (!api) return;
    void (async () => {
      const [nextRuntime, nextSnapshot, page, nextUsage, nextDiagnostics] =
        await Promise.all([
          api.ping(),
          api.getSnapshot(),
          api.listHistory({ limit: HISTORY_PAGE_SIZE }),
          api.getUsageStats(),
          api.getDiagnostics(),
        ]);
      if (!mounted.current) return;
      setRuntime(nextRuntime);
      setSnapshot(nextSnapshot);
      setHistory(page);
      setHistoryExhausted(page.length < HISTORY_PAGE_SIZE);
      setUsage(nextUsage);
      setDiagnostics(nextDiagnostics);
    })().catch((error: unknown) => {
      void api
        .reportRendererIssue({
          message: describeError(error) ?? 'Renderer initialization failed',
          stack: error instanceof Error ? error.stack : undefined,
        })
        .catch(() => undefined);
    });
  }, []);

  const reloadDiagnostics = useCallback(async () => {
    const next = await requireApi().getDiagnostics();
    if (mounted.current) setDiagnostics(next);
  }, []);

  useEffect(() => {
    const api = window.untypo;
    if (!api) return;
    return api.onDiagnosticsChanged(() => {
      void reloadDiagnostics();
    });
  }, [reloadDiagnostics]);

  useEffect(() => {
    const api = window.untypo;
    if (!api) return;
    return api.onSnapshotChanged((next) => {
      if (mounted.current) setSnapshot(next);
    });
  }, []);

  useEffect(() => {
    const api = window.untypo;
    if (!api) return;
    return api.onUpdateChanged((update) => {
      if (!mounted.current) return;
      setSnapshot((current) =>
        current ? { ...current, update: structuredClone(update) } : current,
      );
    });
  }, []);

  const applySnapshot = useCallback((next: ClientSnapshot) => {
    if (mounted.current) setSnapshot(next);
  }, []);

  const acceptWritingPreference = useCallback(
    async (id: string) => {
      applySnapshot(await requireApi().acceptWritingPreference(id));
    },
    [applySnapshot],
  );

  const clearPersonalizationMemory = useCallback(async () => {
    applySnapshot(await requireApi().clearPersonalizationMemory());
  }, [applySnapshot]);

  const reloadHistory = useCallback(async () => {
    const [page, nextUsage] = await Promise.all([
      requireApi().listHistory({ limit: HISTORY_PAGE_SIZE }),
      requireApi().getUsageStats(),
    ]);
    if (!mounted.current) return;
    setHistory(page);
    setHistoryExhausted(page.length < HISTORY_PAGE_SIZE);
    setUsage(nextUsage);
  }, []);

  const loadMoreHistory = useCallback(async () => {
    const page = await requireApi().listHistory({
      limit: HISTORY_PAGE_SIZE,
      offset: history.length,
    });
    if (!mounted.current) return;
    setHistory((current) => mergeHistoryPage(current, page));
    setHistoryExhausted(page.length < HISTORY_PAGE_SIZE);
  }, [history.length]);

  const listMicrophones = useCallback(() => requireApi().listMicrophones(), []);

  const clearHistory = useCallback(async () => {
    await requireApi().clearHistory();
    if (!mounted.current) return;
    setHistory([]);
    setHistoryExhausted(true);
    setUsage({
      outputCharacters: 0,
      transcriptionDurationMs: 0,
      usageCount: 0,
    });
  }, []);

  const copyText = useCallback(
    (text: string) => requireApi().copyText(text),
    [],
  );

  const acknowledgeDiagnostics = useCallback(
    async (issueIds: readonly string[]) => {
      const next = await requireApi().acknowledgeDiagnostics(issueIds);
      if (mounted.current) setDiagnostics(next);
    },
    [],
  );

  const clearDiagnostics = useCallback(async () => {
    const next = await requireApi().clearDiagnostics();
    if (mounted.current) setDiagnostics(next);
  }, []);

  const exportDiagnostics = useCallback(
    (request: ClientDiagnosticExportRequest) =>
      requireApi().exportDiagnostics(request),
    [],
  );

  const updateSettings = useCallback(
    async (update: ClientSettingsUpdate) => {
      applySnapshot(await requireApi().updateSettings(update));
    },
    [applySnapshot],
  );

  const checkForUpdates = useCallback(async () => {
    const update = await requireApi().checkForUpdates();
    if (!mounted.current) return;
    setSnapshot((current) =>
      current ? { ...current, update: structuredClone(update) } : current,
    );
  }, []);

  const downloadUpdate = useCallback(async () => {
    const update = await requireApi().downloadUpdate();
    if (!mounted.current) return;
    setSnapshot((current) =>
      current ? { ...current, update: structuredClone(update) } : current,
    );
  }, []);

  const installUpdate = useCallback(() => requireApi().installUpdate(), []);

  const upsertProvider = useCallback(
    async (profile: ClientProviderInput) => {
      applySnapshot(await requireApi().upsertProvider(profile));
    },
    [applySnapshot],
  );

  const removeProvider = useCallback(
    async (profileId: string) => {
      applySnapshot(await requireApi().removeProvider(profileId));
    },
    [applySnapshot],
  );

  const addDictionaryEntry = useCallback(
    async (term: string) => {
      applySnapshot(await requireApi().addDictionaryEntry(term));
    },
    [applySnapshot],
  );

  const removeDictionaryEntry = useCallback(
    async (term: string) => {
      applySnapshot(await requireApi().removeDictionaryEntry(term));
    },
    [applySnapshot],
  );

  const removeWritingPreference = useCallback(
    async (id: string) => {
      applySnapshot(await requireApi().removeWritingPreference(id));
    },
    [applySnapshot],
  );

  const rejectWritingPreference = useCallback(
    async (id: string) => {
      applySnapshot(await requireApi().rejectWritingPreference(id));
    },
    [applySnapshot],
  );

  const setDictionaryLearningEnabled = useCallback(
    async (enabled: boolean) => {
      applySnapshot(await requireApi().setDictionaryLearningEnabled(enabled));
    },
    [applySnapshot],
  );

  const setApplicationWritingStyle = useCallback(
    async (update: ClientApplicationWritingStyleUpdate) => {
      applySnapshot(await requireApi().setApplicationWritingStyle(update));
    },
    [applySnapshot],
  );

  const setPersonalizationLearningEnabled = useCallback(
    async (enabled: boolean) => {
      applySnapshot(
        await requireApi().setPersonalizationLearningEnabled(enabled),
      );
    },
    [applySnapshot],
  );

  const setProfile = useCallback(
    async (profile?: UserProfileContext) => {
      applySnapshot(await requireApi().setProfile(profile));
    },
    [applySnapshot],
  );

  const testProvider = useCallback(async (profileId: string) => {
    await requireApi().testProvider(profileId);
  }, []);

  return {
    acceptWritingPreference,
    addDictionaryEntry,
    acknowledgeDiagnostics,
    checkForUpdates,
    clearDiagnostics,
    clearHistory,
    clearPersonalizationMemory,
    copyText,
    diagnostics,
    downloadUpdate,
    exportDiagnostics,
    history,
    historyExhausted,
    installUpdate,
    loadMoreHistory,
    listMicrophones,
    reloadDiagnostics,
    reloadHistory,
    removeProvider,
    removeDictionaryEntry,
    removeWritingPreference,
    rejectWritingPreference,
    runtime,
    usage,
    setDictionaryLearningEnabled,
    setApplicationWritingStyle,
    setProfile,
    setPersonalizationLearningEnabled,
    snapshot,
    testProvider,
    updateSettings,
    upsertProvider,
  };
};
