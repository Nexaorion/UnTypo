import type { UserProfileContext } from '../../core/providers/contracts.js';
import {
  dictionaryTermKey,
  DICTIONARY_LIMITS,
  type DictionaryEntry,
} from '../../shared/dictionary.js';
import { PERSONALIZATION_LIMITS } from '../../shared/personalization.js';
import {
  parseDictionary,
  parseDictionaryLearningState,
  parsePersonalization,
  parsePersonalizationState,
  parseUserProfile,
  type DictionaryLearningPrivateState,
  type PersonalizationPrivateState,
  type StoredClientConfig,
} from '../storage/configuration.js';
import type { HistoryRecord } from '../storage/history.js';

export interface SyncLocalState {
  dictionary: readonly DictionaryEntry[];
  dictionaryLearning: DictionaryLearningPrivateState;
  personalization: StoredClientConfig['personalization'];
  personalizationLearning: PersonalizationPrivateState;
  profile?: UserProfileContext;
  profileUpdatedAt: number;
}

export interface ValidatedSyncPayload {
  dictionary: readonly DictionaryEntry[];
  dictionaryLearningState?: DictionaryLearningPrivateState;
  exportedAt: number;
  history: readonly HistoryRecord[];
  personalization: StoredClientConfig['personalization'];
  personalizationLearning?: PersonalizationPrivateState;
  profile?: UserProfileContext;
}

export interface MergedSyncState {
  dictionary: readonly DictionaryEntry[];
  dictionaryLearning: DictionaryLearningPrivateState;
  history: readonly HistoryRecord[];
  personalization: StoredClientConfig['personalization'];
  personalizationLearning: PersonalizationPrivateState;
  profile?: UserProfileContext;
  recordsMerged: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseOptionalProfile = (value: unknown): UserProfileContext | undefined => {
  if (value === undefined) return undefined;
  return parseUserProfile(value);
};

const parseOptionalProcessingTrace = (value: unknown): HistoryRecord['processingTrace'] => {
  if (
    !isRecord(value) ||
    typeof value.operationId !== 'string' ||
    !Array.isArray(value.modelCalls)
  ) {
    return undefined;
  }
  return value as unknown as HistoryRecord['processingTrace'];
};

const parseHistoryRecord = (value: unknown): HistoryRecord => {
  if (!isRecord(value)) throw new Error('Invalid history record');
  if (
    typeof value.id !== 'string' ||
    value.id.length === 0 ||
    value.id.length > 64 ||
    typeof value.createdAt !== 'number' ||
    !Number.isFinite(value.createdAt) ||
    value.createdAt < 0 ||
    (value.intent !== 'transcription' &&
      value.intent !== 'translation' &&
      value.intent !== 'instruction') ||
    (value.language !== 'zh-CN' && value.language !== 'en-US') ||
    typeof value.outputText !== 'string' ||
    value.outputText.length > 1_000_000 ||
    typeof value.providerId !== 'string' ||
    value.providerId.length === 0 ||
    value.providerId.length > 64 ||
    (value.audioDurationMs !== undefined &&
      (typeof value.audioDurationMs !== 'number' ||
        !Number.isFinite(value.audioDurationMs) ||
        value.audioDurationMs < 0)) ||
    (value.modelName !== undefined &&
      (typeof value.modelName !== 'string' || value.modelName.length > 200)) ||
    (value.rawTranscript !== undefined &&
      (typeof value.rawTranscript !== 'string' || value.rawTranscript.length > 1_000_000)) ||
    (value.scene !== undefined && (typeof value.scene !== 'string' || value.scene.length > 200))
  ) {
    throw new Error('Invalid history record');
  }
  const processingTrace = parseOptionalProcessingTrace(value.processingTrace);
  return {
    createdAt: value.createdAt,
    id: value.id,
    intent: value.intent,
    language: value.language,
    outputText: value.outputText,
    providerId: value.providerId,
    ...(typeof value.audioDurationMs === 'number'
      ? { audioDurationMs: value.audioDurationMs }
      : {}),
    ...(typeof value.modelName === 'string' ? { modelName: value.modelName } : {}),
    ...(processingTrace ? { processingTrace } : {}),
    ...(typeof value.rawTranscript === 'string' ? { rawTranscript: value.rawTranscript } : {}),
    ...(typeof value.scene === 'string' ? { scene: value.scene } : {}),
  };
};

const parseHistoryRecords = (value: unknown): readonly HistoryRecord[] => {
  if (!Array.isArray(value) || value.length > 20_000) {
    throw new Error('Invalid history');
  }
  const seen = new Set<string>();
  const records: HistoryRecord[] = [];
  for (const entry of value) {
    const record = parseHistoryRecord(entry);
    if (seen.has(record.id)) continue;
    seen.add(record.id);
    records.push(record);
  }
  return records;
};

export const parseSyncPayload = (value: {
  dictionary: unknown;
  dictionaryLearningState?: unknown;
  exportedAt: number;
  history: unknown;
  personalization: unknown;
  profile?: unknown;
}): ValidatedSyncPayload => {
  const personalization = parsePersonalization({
    ...(isRecord(value.personalization) ? value.personalization : {}),
    encryptedState: undefined,
  });
  return {
    dictionary: parseDictionary(value.dictionary),
    ...(value.dictionaryLearningState === undefined
      ? {}
      : {
          dictionaryLearningState: parseDictionaryLearningState(value.dictionaryLearningState),
        }),
    exportedAt: value.exportedAt,
    history: parseHistoryRecords(value.history),
    personalization,
    ...(isRecord(value.personalization) && value.personalization.learningState !== undefined
      ? {
          personalizationLearning: parsePersonalizationState(value.personalization.learningState),
        }
      : {}),
    ...(value.profile === undefined ? {} : { profile: parseOptionalProfile(value.profile) }),
  };
};

const mergeDictionary = (
  local: readonly DictionaryEntry[],
  remote: readonly DictionaryEntry[],
): readonly DictionaryEntry[] => {
  const merged = new Map<string, DictionaryEntry>();
  for (const entry of local) merged.set(dictionaryTermKey(entry.term), entry);
  for (const entry of remote) {
    const key = dictionaryTermKey(entry.term);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, entry);
      continue;
    }
    if (existing.source === 'manual' || entry.source !== 'manual') continue;
    merged.set(key, { ...existing, source: 'manual' });
  }
  return [...merged.values()].slice(0, DICTIONARY_LIMITS.entries);
};

const mergeDictionaryLearning = (
  local: DictionaryLearningPrivateState,
  remote?: DictionaryLearningPrivateState,
): DictionaryLearningPrivateState => {
  if (!remote) return structuredClone(local);
  const candidates = new Map(
    local.candidates.map((entry) => [
      dictionaryTermKey(entry.candidate.term),
      structuredClone(entry),
    ]),
  );
  for (const entry of remote.candidates) {
    const key = dictionaryTermKey(entry.candidate.term);
    const existing = candidates.get(key);
    if (!existing) {
      candidates.set(key, structuredClone(entry));
      continue;
    }
    candidates.set(key, {
      candidate: {
        ...existing.candidate,
        confidence: Math.max(existing.candidate.confidence, entry.candidate.confidence),
      },
      firstSeenAt: Math.min(existing.firstSeenAt, entry.firstSeenAt),
      lastSeenAt: Math.max(existing.lastSeenAt, entry.lastSeenAt),
      occurrences: Math.max(existing.occurrences, entry.occurrences),
    });
  }
  const rejections = new Map(
    local.rejections.map((entry) => [entry.fingerprint, structuredClone(entry)]),
  );
  for (const entry of remote.rejections) {
    const existing = rejections.get(entry.fingerprint);
    if (!existing || entry.until > existing.until) {
      rejections.set(entry.fingerprint, structuredClone(entry));
    }
  }
  return {
    candidates: [...candidates.values()].slice(0, DICTIONARY_LIMITS.candidates),
    rejections: [...rejections.values()].slice(0, DICTIONARY_LIMITS.candidates),
  };
};

const mergePersonalizationLearning = (
  local: PersonalizationPrivateState,
  remote?: PersonalizationPrivateState,
): PersonalizationPrivateState => {
  if (!remote) return structuredClone(local);
  const candidates = [...local.candidates];
  for (const entry of remote.candidates) {
    const existing = candidates.find(
      (candidate) =>
        candidate.application === entry.application &&
        candidate.candidate.kind === entry.candidate.kind &&
        candidate.candidate.value === entry.candidate.value,
    );
    if (!existing) {
      candidates.push(structuredClone(entry));
      continue;
    }
    existing.firstSeenAt = Math.min(existing.firstSeenAt, entry.firstSeenAt);
    existing.lastSeenAt = Math.max(existing.lastSeenAt, entry.lastSeenAt);
    existing.occurrences = Math.max(existing.occurrences, entry.occurrences);
    existing.candidate.confidence = Math.max(
      existing.candidate.confidence,
      entry.candidate.confidence,
    );
  }
  const preferences = [...local.preferences];
  for (const entry of remote.preferences) {
    if (preferences.some((preference) => preference.id === entry.id)) continue;
    preferences.push(structuredClone(entry));
  }
  const rejections = new Map(
    local.rejections.map((entry) => [entry.fingerprint, structuredClone(entry)]),
  );
  for (const entry of remote.rejections) {
    const existing = rejections.get(entry.fingerprint);
    if (!existing || entry.until > existing.until) {
      rejections.set(entry.fingerprint, structuredClone(entry));
    }
  }
  return {
    candidates: candidates.slice(0, PERSONALIZATION_LIMITS.candidates),
    preferences: preferences.slice(0, PERSONALIZATION_LIMITS.preferences),
    rejections: [...rejections.values()].slice(0, PERSONALIZATION_LIMITS.candidates),
  };
};

const mergeHistory = (
  local: readonly HistoryRecord[],
  remote: readonly HistoryRecord[],
): { records: readonly HistoryRecord[]; recordsMerged: number } => {
  const ids = new Set(local.map((record) => record.id));
  const extra = remote.filter((record) => {
    if (ids.has(record.id)) return false;
    ids.add(record.id);
    return true;
  });
  return { records: extra, recordsMerged: extra.length };
};

export const mergeSyncState = (
  local: SyncLocalState,
  remote: ValidatedSyncPayload,
  localHistory: readonly HistoryRecord[],
): MergedSyncState => {
  const useRemoteStyles = remote.exportedAt >= local.profileUpdatedAt;
  const personalization = useRemoteStyles
    ? {
        applicationStyles: structuredClone(remote.personalization.applicationStyles),
        learningEnabled: remote.personalization.learningEnabled,
      }
    : {
        applicationStyles: structuredClone(local.personalization.applicationStyles),
        learningEnabled: local.personalization.learningEnabled,
      };
  const profile = useRemoteStyles
    ? (remote.profile ?? local.profile)
    : (local.profile ?? remote.profile);
  const history = mergeHistory(localHistory, remote.history);
  return {
    dictionary: mergeDictionary(local.dictionary, remote.dictionary),
    dictionaryLearning: mergeDictionaryLearning(
      local.dictionaryLearning,
      remote.dictionaryLearningState,
    ),
    history: history.records,
    personalization,
    personalizationLearning: mergePersonalizationLearning(
      local.personalizationLearning,
      remote.personalizationLearning,
    ),
    ...(profile ? { profile } : {}),
    recordsMerged: history.recordsMerged,
  };
};
