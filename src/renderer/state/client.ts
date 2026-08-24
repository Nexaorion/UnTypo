import { useCallback, useEffect, useRef, useState } from 'react';
import type { UserProfileContext } from '../../core/providers/contracts.js';
import type {
  ClientHistoryRecord,
  ClientProviderInput,
  ClientSettingsUpdate,
  ClientSnapshot,
  ClientUsageStats,
  PingResponse,
  UntypoApi,
} from '../../shared/ipc.js';
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
  clearHistory: () => Promise<void>;
  history: readonly ClientHistoryRecord[];
  historyExhausted: boolean;
  loadMoreHistory: () => Promise<void>;
  reloadHistory: () => Promise<void>;
  removeProvider: (profileId: string) => Promise<void>;
  runtime: PingResponse | null;
  usage: ClientUsageStats | null;
  setDictionary: (entries: readonly string[]) => Promise<void>;
  setProfile: (profile?: UserProfileContext) => Promise<void>;
  snapshot: ClientSnapshot | null;
  testProvider: (profileId: string) => Promise<void>;
  updateSettings: (update: ClientSettingsUpdate) => Promise<void>;
  upsertProvider: (profile: ClientProviderInput) => Promise<void>;
}

export const useClientStore = (): ClientStore => {
  const [snapshot, setSnapshot] = useState<ClientSnapshot | null>(null);
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
      const [nextRuntime, nextSnapshot, page, nextUsage] = await Promise.all([
        api.ping(),
        api.getSnapshot(),
        api.listHistory({ limit: HISTORY_PAGE_SIZE }),
        api.getUsageStats(),
      ]);
      if (!mounted.current) return;
      setRuntime(nextRuntime);
      setSnapshot(nextSnapshot);
      setHistory(page);
      setHistoryExhausted(page.length < HISTORY_PAGE_SIZE);
      setUsage(nextUsage);
    })();
  }, []);

  const applySnapshot = useCallback((next: ClientSnapshot) => {
    if (mounted.current) setSnapshot(next);
  }, []);

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

  const updateSettings = useCallback(
    async (update: ClientSettingsUpdate) => {
      applySnapshot(await requireApi().updateSettings(update));
    },
    [applySnapshot],
  );

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

  const setDictionary = useCallback(
    async (entries: readonly string[]) => {
      applySnapshot(await requireApi().setDictionary(entries));
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
    clearHistory,
    history,
    historyExhausted,
    loadMoreHistory,
    reloadHistory,
    removeProvider,
    runtime,
    usage,
    setDictionary,
    setProfile,
    snapshot,
    testProvider,
    updateSettings,
    upsertProvider,
  };
};
