import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  SupportedLanguage,
  UserProfileContext,
} from '../../core/providers/contracts.js';
import type {
  ClientProviderValues,
  ModelProviderId,
  ModelProviderKind,
} from '../../shared/ipc.js';
import {
  dictionaryTermKey,
  DICTIONARY_CANDIDATE_CATEGORIES,
  DICTIONARY_LIMITS,
  normalizeDictionaryTerm,
  type DictionaryCandidate,
  type DictionaryEntry,
  type DictionaryEntrySource,
} from '../../shared/dictionary.js';
import type { EncryptedValue, SecretProtector } from './secret-protector.js';

export interface HistoryPolicy {
  enabled: boolean;
  retentionDays: number;
}

export interface UpdatePolicy {
  autoCheck: boolean;
  autoDownload: boolean;
}

export interface StoredProviderProfile {
  id: string;
  kind: ModelProviderKind;
  providerId: ModelProviderId;
  secrets: Readonly<Record<string, EncryptedValue>>;
  values: Readonly<ClientProviderValues>;
}

export interface StoredClientConfig {
  version: 3;
  general: {
    launchAtLogin: boolean;
    locale: SupportedLanguage;
  };
  dictation: {
    activeSpeechProviderProfileId?: string;
    activeTextProviderProfileId?: string;
    defaultTargetLanguage: SupportedLanguage;
    fastMode?: boolean;
    hotkeyAccelerator: string;
    language: SupportedLanguage;
    microphoneDeviceId?: string;
  };
  dictionary: readonly DictionaryEntry[];
  dictionaryLearning: {
    enabled: boolean;
    encryptedState?: EncryptedValue;
  };
  encryptedProfile?: EncryptedValue;
  history: HistoryPolicy;
  providers: readonly StoredProviderProfile[];
  updates: UpdatePolicy;
}

export interface StoredDictionaryCandidate {
  candidate: DictionaryCandidate;
  firstSeenAt: number;
  lastSeenAt: number;
  occurrences: number;
}

export interface StoredDictionaryRejection {
  fingerprint: string;
  until: number;
}

export interface DictionaryLearningPrivateState {
  candidates: readonly StoredDictionaryCandidate[];
  rejections: readonly StoredDictionaryRejection[];
}

export type DictionaryEntryErrorCode =
  | 'DICTIONARY_DUPLICATE'
  | 'DICTIONARY_EMPTY'
  | 'DICTIONARY_FULL'
  | 'DICTIONARY_TOO_LONG';

export class DictionaryEntryError extends Error {
  readonly code: DictionaryEntryErrorCode;

  constructor(code: DictionaryEntryErrorCode) {
    super(code);
    this.name = 'DictionaryEntryError';
    this.code = code;
  }
}

export interface ProviderProfile {
  id: string;
  kind: ModelProviderKind;
  providerId: ModelProviderId;
  secrets: Readonly<Record<string, string>>;
  values: Readonly<ClientProviderValues>;
}

interface ParsedConfig {
  config: StoredClientConfig;
  migrated: boolean;
}

interface LegacyProviderProfile {
  id: string;
  secrets: Readonly<Record<string, EncryptedValue>>;
  values: {
    allowInsecurePrivateEndpoint?: boolean;
    baseUrl: string;
    name: string;
    textModel: string;
    transcriptionModel: string;
  };
}

const profileIdPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/u;

const providerKinds: Readonly<Record<ModelProviderId, ModelProviderKind>> = {
  'aliyun-bailian-speech': 'speech',
  'anthropic-text': 'text',
  'openai-compatible-speech': 'speech',
  'openai-compatible-text': 'text',
  'openai-responses-text': 'text',
};

export const DEFAULT_HOTKEY_ACCELERATOR = 'Ctrl+Alt+Space';
const LEGACY_DEFAULT_HOTKEY_ACCELERATOR = 'Ctrl+Shift+Space';

const migrateDefaultHotkey = (accelerator: string): string =>
  accelerator === LEGACY_DEFAULT_HOTKEY_ACCELERATOR
    ? DEFAULT_HOTKEY_ACCELERATOR
    : accelerator;

const defaultConfig = (): StoredClientConfig => ({
  version: 3,
  general: {
    launchAtLogin: false,
    locale: 'zh-CN',
  },
  dictation: {
    defaultTargetLanguage: 'en-US',
    hotkeyAccelerator: DEFAULT_HOTKEY_ACCELERATOR,
    language: 'zh-CN',
  },
  dictionary: [],
  dictionaryLearning: { enabled: true },
  history: {
    enabled: true,
    retentionDays: 30,
  },
  providers: [],
  updates: {
    autoCheck: true,
    autoDownload: true,
  },
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const assertOnlyKeys = (
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void => {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new Error(`${label} contains an unsupported field`);
  }
};

const isNonEmptyString = (
  value: unknown,
  maximumLength: number,
): value is string =>
  typeof value === 'string' &&
  value.trim().length > 0 &&
  value.length <= maximumLength;

const isProviderId = (value: unknown): value is ModelProviderId =>
  typeof value === 'string' && value in providerKinds;

const isEncryptedValue = (value: unknown): value is EncryptedValue =>
  isRecord(value) &&
  isNonEmptyString(value.ciphertext, 1_000_000) &&
  isNonEmptyString(value.scheme, 200);

const assertLanguage = (value: unknown, field: string): SupportedLanguage => {
  if (value !== 'zh-CN' && value !== 'en-US') {
    throw new Error(`Invalid ${field}`);
  }
  return value;
};

const parseGeneral = (value: unknown): StoredClientConfig['general'] => {
  if (!isRecord(value) || typeof value.launchAtLogin !== 'boolean') {
    throw new Error('Invalid general settings');
  }
  return {
    launchAtLogin: value.launchAtLogin,
    locale: assertLanguage(value.locale, 'locale'),
  };
};

const parseHistory = (value: unknown): HistoryPolicy => {
  if (
    !isRecord(value) ||
    typeof value.enabled !== 'boolean' ||
    typeof value.retentionDays !== 'number' ||
    !Number.isFinite(value.retentionDays) ||
    value.retentionDays < 0
  ) {
    throw new Error('Invalid history settings');
  }
  return {
    enabled: value.enabled,
    retentionDays: value.retentionDays,
  };
};

const parseUpdates = (value: unknown): UpdatePolicy => {
  if (value === undefined) {
    return { autoCheck: true, autoDownload: true };
  }
  if (
    !isRecord(value) ||
    typeof value.autoCheck !== 'boolean' ||
    typeof value.autoDownload !== 'boolean'
  ) {
    throw new Error('Invalid update settings');
  }
  assertOnlyKeys(value, ['autoCheck', 'autoDownload'], 'Update settings');
  return {
    autoCheck: value.autoCheck,
    autoDownload: value.autoDownload,
  };
};

const parseLegacyDictionary = (value: unknown): readonly DictionaryEntry[] => {
  if (
    !Array.isArray(value) ||
    value.length > DICTIONARY_LIMITS.entries ||
    !value.every(
      (entry) =>
        typeof entry === 'string' &&
        entry.length <= DICTIONARY_LIMITS.termLength,
    )
  ) {
    throw new Error('Invalid dictionary');
  }
  const seen = new Set<string>();
  const entries: DictionaryEntry[] = [];
  for (const source of value as string[]) {
    const term = normalizeDictionaryTerm(source);
    if (term.length > DICTIONARY_LIMITS.termLength) {
      throw new Error('Invalid dictionary');
    }
    const key = dictionaryTermKey(term);
    if (!term || seen.has(key)) continue;
    seen.add(key);
    entries.push({ source: 'manual', term });
  }
  return entries;
};

const parseDictionary = (value: unknown): readonly DictionaryEntry[] => {
  if (!Array.isArray(value) || value.length > DICTIONARY_LIMITS.entries) {
    throw new Error('Invalid dictionary');
  }
  const seen = new Set<string>();
  const entries: DictionaryEntry[] = [];
  for (const entry of value) {
    if (
      !isRecord(entry) ||
      typeof entry.term !== 'string' ||
      entry.term.length > DICTIONARY_LIMITS.termLength ||
      (entry.source !== 'manual' && entry.source !== 'learned')
    ) {
      throw new Error('Invalid dictionary');
    }
    const term = normalizeDictionaryTerm(entry.term);
    if (term.length > DICTIONARY_LIMITS.termLength) {
      throw new Error('Invalid dictionary');
    }
    const key = dictionaryTermKey(term);
    if (!term || seen.has(key)) throw new Error('Invalid dictionary');
    seen.add(key);
    entries.push({ source: entry.source, term });
  }
  return entries;
};

const parseDictionaryLearning = (
  value: unknown,
): StoredClientConfig['dictionaryLearning'] => {
  if (!isRecord(value) || typeof value.enabled !== 'boolean') {
    throw new Error('Invalid dictionary learning settings');
  }
  assertOnlyKeys(value, ['enabled', 'encryptedState'], 'Dictionary learning');
  if (
    value.encryptedState !== undefined &&
    !isEncryptedValue(value.encryptedState)
  ) {
    throw new Error('Invalid dictionary learning state');
  }
  return {
    enabled: value.enabled,
    ...(isEncryptedValue(value.encryptedState)
      ? { encryptedState: structuredClone(value.encryptedState) }
      : {}),
  };
};

const emptyDictionaryLearningState = (): DictionaryLearningPrivateState => ({
  candidates: [],
  rejections: [],
});

const parseDictionaryLearningState = (
  value: unknown,
): DictionaryLearningPrivateState => {
  if (
    !isRecord(value) ||
    !Array.isArray(value.candidates) ||
    !Array.isArray(value.rejections) ||
    value.candidates.length > DICTIONARY_LIMITS.candidates ||
    value.rejections.length > DICTIONARY_LIMITS.candidates
  ) {
    throw new Error('Invalid encrypted dictionary learning state');
  }
  const candidates: StoredDictionaryCandidate[] = value.candidates.map(
    (entry) => {
      if (
        !isRecord(entry) ||
        !isRecord(entry.candidate) ||
        typeof entry.candidate.term !== 'string' ||
        entry.candidate.term.length > DICTIONARY_LIMITS.termLength ||
        !DICTIONARY_CANDIDATE_CATEGORIES.includes(
          entry.candidate.category as never,
        ) ||
        typeof entry.candidate.confidence !== 'number' ||
        !Number.isFinite(entry.candidate.confidence) ||
        entry.candidate.confidence < 0 ||
        entry.candidate.confidence > 1 ||
        typeof entry.firstSeenAt !== 'number' ||
        !Number.isFinite(entry.firstSeenAt) ||
        typeof entry.lastSeenAt !== 'number' ||
        !Number.isFinite(entry.lastSeenAt) ||
        typeof entry.occurrences !== 'number' ||
        !Number.isInteger(entry.occurrences) ||
        entry.occurrences < 1
      ) {
        throw new Error('Invalid encrypted dictionary candidate');
      }
      const term = normalizeDictionaryTerm(entry.candidate.term);
      if (!term || term.length > DICTIONARY_LIMITS.termLength) {
        throw new Error('Invalid encrypted dictionary candidate');
      }
      return {
        candidate: {
          category: entry.candidate.category as DictionaryCandidate['category'],
          confidence: entry.candidate.confidence,
          term,
        },
        firstSeenAt: entry.firstSeenAt,
        lastSeenAt: entry.lastSeenAt,
        occurrences: entry.occurrences,
      };
    },
  );
  const rejections: StoredDictionaryRejection[] = value.rejections.map(
    (entry) => {
      if (
        !isRecord(entry) ||
        !isNonEmptyString(entry.fingerprint, 128) ||
        typeof entry.until !== 'number' ||
        !Number.isFinite(entry.until)
      ) {
        throw new Error('Invalid encrypted dictionary rejection');
      }
      return { fingerprint: entry.fingerprint, until: entry.until };
    },
  );
  return { candidates, rejections };
};

const parseEncryptedProfile = (
  value: Record<string, unknown>,
): EncryptedValue | undefined => {
  if (value.encryptedProfile === undefined) return undefined;
  if (!isEncryptedValue(value.encryptedProfile)) {
    throw new Error('Invalid encrypted profile');
  }
  return structuredClone(value.encryptedProfile);
};

const parseProviderValues = (value: unknown): ClientProviderValues => {
  if (!isRecord(value)) throw new Error('Invalid provider values');
  assertOnlyKeys(
    value,
    ['allowInsecurePrivateEndpoint', 'baseUrl', 'model', 'name', 'presetId'],
    'Provider values',
  );
  if (
    !isNonEmptyString(value.name, 200) ||
    !isNonEmptyString(value.presetId, 100) ||
    !isNonEmptyString(value.model, 200) ||
    !isNonEmptyString(value.baseUrl, 2_048) ||
    (value.allowInsecurePrivateEndpoint !== undefined &&
      typeof value.allowInsecurePrivateEndpoint !== 'boolean')
  ) {
    throw new Error('Invalid provider values');
  }
  return {
    name: value.name,
    presetId: value.presetId,
    model: value.model,
    baseUrl: value.baseUrl,
    ...(typeof value.allowInsecurePrivateEndpoint === 'boolean'
      ? {
          allowInsecurePrivateEndpoint: value.allowInsecurePrivateEndpoint,
        }
      : {}),
  };
};

const parseSecrets = (
  value: unknown,
): Readonly<Record<string, EncryptedValue>> => {
  if (!isRecord(value)) throw new Error('Invalid provider secrets');
  assertOnlyKeys(value, ['apiKey'], 'Provider secrets');
  if (!isEncryptedValue(value.apiKey)) {
    throw new Error('Invalid provider secrets');
  }
  return { apiKey: structuredClone(value.apiKey) };
};

const parseStoredProvider = (value: unknown): StoredProviderProfile => {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.id, 64) ||
    !profileIdPattern.test(value.id) ||
    (value.kind !== 'speech' && value.kind !== 'text') ||
    !isProviderId(value.providerId) ||
    providerKinds[value.providerId] !== value.kind
  ) {
    throw new Error('Invalid provider profile');
  }
  return {
    id: value.id,
    kind: value.kind,
    providerId: value.providerId,
    secrets: parseSecrets(value.secrets),
    values: parseProviderValues(value.values),
  };
};

const parseCommonData = (
  value: Record<string, unknown>,
): Pick<
  StoredClientConfig,
  'encryptedProfile' | 'general' | 'history' | 'updates'
> => {
  const encryptedProfile = parseEncryptedProfile(value);
  return {
    ...(encryptedProfile ? { encryptedProfile } : {}),
    general: parseGeneral(value.general),
    history: parseHistory(value.history),
    updates: parseUpdates(value.updates),
  };
};

const assertUniqueProviderIds = (
  providers: readonly StoredProviderProfile[],
): void => {
  if (new Set(providers.map(({ id }) => id)).size !== providers.length) {
    throw new Error('Provider profile ids must be unique');
  }
};

const parseV2Config = (value: Record<string, unknown>): StoredClientConfig => {
  if (!isRecord(value.dictation)) {
    throw new Error('Invalid dictation settings');
  }
  const dictation = value.dictation;
  if (
    !isNonEmptyString(dictation.hotkeyAccelerator, 128) ||
    (dictation.hotkeyMode !== undefined &&
      dictation.hotkeyMode !== 'push-to-talk' &&
      dictation.hotkeyMode !== 'toggle') ||
    (dictation.fastMode !== undefined &&
      typeof dictation.fastMode !== 'boolean') ||
    (dictation.activeSpeechProviderProfileId !== undefined &&
      (!isNonEmptyString(dictation.activeSpeechProviderProfileId, 64) ||
        !profileIdPattern.test(dictation.activeSpeechProviderProfileId))) ||
    (dictation.activeTextProviderProfileId !== undefined &&
      (!isNonEmptyString(dictation.activeTextProviderProfileId, 64) ||
        !profileIdPattern.test(dictation.activeTextProviderProfileId))) ||
    (dictation.microphoneDeviceId !== undefined &&
      !isNonEmptyString(dictation.microphoneDeviceId, 512)) ||
    !Array.isArray(value.providers)
  ) {
    throw new Error('Invalid configuration data');
  }

  const providers = value.providers.map(parseStoredProvider);
  assertUniqueProviderIds(providers);
  if (
    typeof dictation.activeSpeechProviderProfileId === 'string' &&
    !providers.some(
      ({ id, kind }) =>
        id === dictation.activeSpeechProviderProfileId && kind === 'speech',
    )
  ) {
    throw new Error('Active speech provider profile is invalid');
  }
  if (
    typeof dictation.activeTextProviderProfileId === 'string' &&
    !providers.some(
      ({ id, kind }) =>
        id === dictation.activeTextProviderProfileId && kind === 'text',
    )
  ) {
    throw new Error('Active text provider profile is invalid');
  }
  return {
    version: 3,
    ...parseCommonData(value),
    dictionary: parseLegacyDictionary(value.dictionary),
    dictionaryLearning: { enabled: true },
    dictation: {
      ...(typeof dictation.activeSpeechProviderProfileId === 'string'
        ? {
            activeSpeechProviderProfileId:
              dictation.activeSpeechProviderProfileId,
          }
        : {}),
      ...(typeof dictation.activeTextProviderProfileId === 'string'
        ? {
            activeTextProviderProfileId: dictation.activeTextProviderProfileId,
          }
        : {}),
      defaultTargetLanguage: assertLanguage(
        dictation.defaultTargetLanguage,
        'default target language',
      ),
      ...(typeof dictation.fastMode === 'boolean'
        ? { fastMode: dictation.fastMode }
        : {}),
      hotkeyAccelerator: migrateDefaultHotkey(dictation.hotkeyAccelerator),
      language: assertLanguage(dictation.language, 'dictation language'),
      ...(typeof dictation.microphoneDeviceId === 'string'
        ? { microphoneDeviceId: dictation.microphoneDeviceId }
        : {}),
    },
    providers,
  };
};

const parseV3Config = (value: Record<string, unknown>): StoredClientConfig => {
  const rawDictionary: readonly unknown[] = Array.isArray(value.dictionary)
    ? value.dictionary
    : [];
  const base = parseV2Config({
    ...value,
    dictionary: rawDictionary.map((entry) =>
      isRecord(entry) ? entry.term : entry,
    ),
  });
  return {
    ...base,
    version: 3,
    dictionary: parseDictionary(value.dictionary),
    dictionaryLearning: parseDictionaryLearning(value.dictionaryLearning),
  };
};

const normalizeProfileId = (value: string, fallback: string): string => {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, '-')
    .replace(/^[^a-z0-9]+/u, '')
    .slice(0, 64);
  return normalized && profileIdPattern.test(normalized)
    ? normalized
    : fallback;
};

const reserveUniqueProfileId = (
  preferred: string,
  reserved: Set<string>,
): string => {
  const base = normalizeProfileId(preferred, 'migrated-provider');
  for (let counter = 1; ; counter += 1) {
    const suffix = counter === 1 ? '' : `-${counter}`;
    const candidate = `${base.slice(0, 64 - suffix.length)}${suffix}`;
    if (!reserved.has(candidate)) {
      reserved.add(candidate);
      return candidate;
    }
  }
};

const parseLegacyProvider = (value: unknown): LegacyProviderProfile => {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    value.providerId !== 'openai' ||
    !isRecord(value.values)
  ) {
    throw new Error('Invalid legacy provider profile');
  }
  const textModel = value.values.textModel;
  const transcriptionModel = value.values.transcriptionModel;
  const baseUrl = value.values.baseUrl;
  const name = value.values.name;
  const allowInsecurePrivateEndpoint =
    value.values.allowInsecurePrivateEndpoint;
  if (
    !isNonEmptyString(textModel, 200) ||
    !isNonEmptyString(transcriptionModel, 200) ||
    (baseUrl !== undefined && !isNonEmptyString(baseUrl, 2_048)) ||
    (name !== undefined && !isNonEmptyString(name, 200)) ||
    (allowInsecurePrivateEndpoint !== undefined &&
      typeof allowInsecurePrivateEndpoint !== 'boolean')
  ) {
    throw new Error('Invalid legacy provider values');
  }
  return {
    id: value.id,
    secrets: parseSecrets(value.secrets),
    values: {
      ...(typeof allowInsecurePrivateEndpoint === 'boolean'
        ? { allowInsecurePrivateEndpoint }
        : {}),
      baseUrl:
        typeof baseUrl === 'string' ? baseUrl : 'https://api.openai.com/v1',
      name:
        typeof name === 'string'
          ? name
          : isNonEmptyString(value.id, 200)
            ? value.id
            : 'Migrated OpenAI',
      textModel,
      transcriptionModel,
    },
  };
};

const tryParseLegacyProvider = (
  value: unknown,
): LegacyProviderProfile | undefined => {
  try {
    return parseLegacyProvider(value);
  } catch {
    // v1 disk parsing allowed unknown or incomplete provider records, while the
    // runtime ignored them. Keep upgrades bootable by migrating only profiles
    // that the old runtime could actually activate.
    return undefined;
  }
};

const migrateV1Config = (
  value: Record<string, unknown>,
): StoredClientConfig => {
  if (!isRecord(value.dictation) || !Array.isArray(value.providers)) {
    throw new Error('Invalid legacy configuration data');
  }
  const dictation = value.dictation;
  if (
    !isNonEmptyString(dictation.hotkeyAccelerator, 128) ||
    (dictation.hotkeyMode !== 'push-to-talk' &&
      dictation.hotkeyMode !== 'toggle') ||
    (dictation.activeProviderProfileId !== undefined &&
      typeof dictation.activeProviderProfileId !== 'string')
  ) {
    throw new Error('Invalid legacy dictation settings');
  }

  const legacyProviders = value.providers
    .map(tryParseLegacyProvider)
    .filter(
      (profile): profile is LegacyProviderProfile => profile !== undefined,
    );
  const reservedIds = new Set<string>();
  const migratedIds = legacyProviders.map((profile) => ({
    legacyId: profile.id,
    speechId: reserveUniqueProfileId(profile.id, reservedIds),
    textId: '',
  }));
  for (const ids of migratedIds) {
    ids.textId = reserveUniqueProfileId(
      `${ids.speechId.slice(0, 59)}-text`,
      reservedIds,
    );
  }

  const providers: StoredProviderProfile[] = [];
  for (const [index, profile] of legacyProviders.entries()) {
    const ids = migratedIds[index];
    if (!ids) throw new Error('Invalid legacy provider migration');
    const sharedValues = {
      ...(typeof profile.values.allowInsecurePrivateEndpoint === 'boolean'
        ? {
            allowInsecurePrivateEndpoint:
              profile.values.allowInsecurePrivateEndpoint,
          }
        : {}),
      baseUrl: profile.values.baseUrl,
      name: profile.values.name,
    };
    const isDefaultOpenAIEndpoint =
      profile.values.baseUrl.replace(/\/+$/u, '') ===
      'https://api.openai.com/v1';
    providers.push(
      {
        id: ids.speechId,
        kind: 'speech',
        providerId: 'openai-compatible-speech',
        secrets: structuredClone(profile.secrets),
        values: {
          ...sharedValues,
          model: profile.values.transcriptionModel,
          presetId: isDefaultOpenAIEndpoint
            ? 'openai-speech'
            : 'custom-openai-speech',
        },
      },
      {
        id: ids.textId,
        kind: 'text',
        providerId: 'openai-compatible-text',
        secrets: structuredClone(profile.secrets),
        values: {
          ...sharedValues,
          model: profile.values.textModel,
          presetId: isDefaultOpenAIEndpoint ? 'openai-text' : 'custom-text',
        },
      },
    );
  }

  const activeIds =
    typeof dictation.activeProviderProfileId === 'string'
      ? migratedIds.find(
          ({ legacyId }) => legacyId === dictation.activeProviderProfileId,
        )
      : migratedIds[0];
  return {
    version: 3,
    ...parseCommonData(value),
    dictionary: parseLegacyDictionary(value.dictionary),
    dictionaryLearning: { enabled: true },
    dictation: {
      ...(activeIds
        ? {
            activeSpeechProviderProfileId: activeIds.speechId,
            activeTextProviderProfileId: activeIds.textId,
          }
        : {}),
      defaultTargetLanguage: assertLanguage(
        dictation.defaultTargetLanguage,
        'default target language',
      ),
      hotkeyAccelerator: migrateDefaultHotkey(dictation.hotkeyAccelerator),
      language: assertLanguage(dictation.language, 'dictation language'),
    },
    providers,
  };
};

const parseConfig = (source: string): ParsedConfig => {
  const value: unknown = JSON.parse(source);
  if (!isRecord(value)) throw new Error('Invalid configuration data');
  if (value.version === 3) {
    const config = parseV3Config(value);
    return {
      config,
      migrated:
        value.updates === undefined ||
        (isRecord(value.dictation) &&
          (value.dictation.hotkeyAccelerator ===
            LEGACY_DEFAULT_HOTKEY_ACCELERATOR ||
            value.dictation.hotkeyMode !== undefined)),
    };
  }
  if (value.version === 2) {
    return { config: parseV2Config(value), migrated: true };
  }
  if (value.version === 1) {
    return { config: migrateV1Config(value), migrated: true };
  }
  throw new Error('Unsupported configuration version');
};

const serializeConfig = (config: StoredClientConfig): string =>
  `${JSON.stringify(config, null, 2)}\n`;

export class ConfigurationService {
  readonly #configPath: string;
  readonly #protector: SecretProtector;
  #queue: Promise<void> = Promise.resolve();

  constructor(configPath: string, protector: SecretProtector) {
    this.#configPath = configPath;
    this.#protector = protector;
  }

  async load(): Promise<StoredClientConfig> {
    return this.runExclusive(async () => {
      const parsed = await this.readFromDisk();
      if (parsed.migrated) await this.writeAtomically(parsed.config);
      return structuredClone(parsed.config);
    });
  }

  async update(
    mutate: (config: StoredClientConfig) => StoredClientConfig,
  ): Promise<StoredClientConfig> {
    return this.runExclusive(async () => {
      const current = (await this.readFromDisk()).config;
      const next = mutate(structuredClone(current));
      await this.writeAtomically(next);
      return structuredClone(next);
    });
  }

  async addDictionaryEntry(
    term: string,
    source: DictionaryEntrySource = 'manual',
  ): Promise<StoredClientConfig> {
    const normalized = normalizeDictionaryTerm(term);
    if (!normalized) throw new DictionaryEntryError('DICTIONARY_EMPTY');
    if (normalized.length > DICTIONARY_LIMITS.termLength) {
      throw new DictionaryEntryError('DICTIONARY_TOO_LONG');
    }
    return this.update((config) => {
      if (
        config.dictionary.some(
          (entry) =>
            dictionaryTermKey(entry.term) === dictionaryTermKey(normalized),
        )
      ) {
        throw new DictionaryEntryError('DICTIONARY_DUPLICATE');
      }
      if (config.dictionary.length >= DICTIONARY_LIMITS.entries) {
        throw new DictionaryEntryError('DICTIONARY_FULL');
      }
      return {
        ...config,
        dictionary: [...config.dictionary, { source, term: normalized }],
      };
    });
  }

  async removeDictionaryEntry(term: string): Promise<StoredClientConfig> {
    const key = dictionaryTermKey(term);
    return this.update((config) => ({
      ...config,
      dictionary: config.dictionary.filter(
        (entry) => dictionaryTermKey(entry.term) !== key,
      ),
    }));
  }

  async setDictionaryLearningEnabled(
    enabled: boolean,
  ): Promise<StoredClientConfig> {
    return this.update((config) => ({
      ...config,
      dictionaryLearning: { enabled },
    }));
  }

  async getDictionaryLearningState(): Promise<DictionaryLearningPrivateState> {
    const config = await this.load();
    if (!config.dictionaryLearning.encryptedState) {
      return emptyDictionaryLearningState();
    }
    return parseDictionaryLearningState(
      JSON.parse(
        this.#protector.reveal(config.dictionaryLearning.encryptedState),
      ) as unknown,
    );
  }

  async updateDictionaryLearningState(
    mutate: (
      state: DictionaryLearningPrivateState,
      config: StoredClientConfig,
    ) => DictionaryLearningPrivateState,
  ): Promise<DictionaryLearningPrivateState> {
    return this.runExclusive(async () => {
      const current = (await this.readFromDisk()).config;
      const stored = current.dictionaryLearning.encryptedState;
      const state = stored
        ? parseDictionaryLearningState(
            JSON.parse(this.#protector.reveal(stored)) as unknown,
          )
        : emptyDictionaryLearningState();
      if (!current.dictionaryLearning.enabled) {
        return emptyDictionaryLearningState();
      }
      const nextState = parseDictionaryLearningState(
        structuredClone(mutate(structuredClone(state), current)),
      );
      const next: StoredClientConfig = {
        ...current,
        dictionaryLearning: {
          enabled: true,
          encryptedState: this.#protector.protect(JSON.stringify(nextState)),
        },
      };
      await this.writeAtomically(next);
      return structuredClone(nextState);
    });
  }

  async setProfile(profile?: UserProfileContext): Promise<StoredClientConfig> {
    const encryptedProfile = profile
      ? this.#protector.protect(JSON.stringify(profile))
      : undefined;
    return this.update((config) => {
      const next = { ...config };
      if (encryptedProfile) next.encryptedProfile = encryptedProfile;
      else delete next.encryptedProfile;
      return next;
    });
  }

  async getProfile(): Promise<UserProfileContext | undefined> {
    const config = await this.load();
    if (!config.encryptedProfile) return undefined;
    const value: unknown = JSON.parse(
      this.#protector.reveal(config.encryptedProfile),
    );
    if (!isRecord(value)) throw new Error('Invalid encrypted profile');
    return value;
  }

  async upsertProvider(profile: ProviderProfile): Promise<StoredClientConfig> {
    if (
      !profileIdPattern.test(profile.id) ||
      providerKinds[profile.providerId] !== profile.kind
    ) {
      throw new Error('Invalid provider profile');
    }
    assertOnlyKeys(profile.secrets, ['apiKey'], 'Provider secrets');
    const values = parseProviderValues(profile.values);
    const apiKey = profile.secrets.apiKey;
    if (
      apiKey !== undefined &&
      (!isNonEmptyString(apiKey, 16_384) || apiKey.trim().length === 0)
    ) {
      throw new Error('Invalid provider API key');
    }

    return this.update((config) => {
      const existing = config.providers.find(
        (entry) => entry.id === profile.id,
      );
      if (existing && existing.kind !== profile.kind) {
        throw new Error('A provider profile cannot change kind');
      }
      const encryptedApiKey =
        apiKey === undefined
          ? existing?.secrets.apiKey
          : this.#protector.protect(apiKey);
      if (!encryptedApiKey) {
        throw new Error('A new provider profile requires an API key');
      }
      const stored: StoredProviderProfile = {
        id: profile.id,
        kind: profile.kind,
        providerId: profile.providerId,
        secrets: { apiKey: encryptedApiKey },
        values,
      };
      const dictation = { ...config.dictation };
      if (
        profile.kind === 'speech' &&
        dictation.activeTextProviderProfileId === profile.id
      ) {
        delete dictation.activeTextProviderProfileId;
      }
      if (
        profile.kind === 'text' &&
        dictation.activeSpeechProviderProfileId === profile.id
      ) {
        delete dictation.activeSpeechProviderProfileId;
      }
      return {
        ...config,
        dictation,
        providers: [
          ...config.providers.filter((entry) => entry.id !== profile.id),
          stored,
        ],
      };
    });
  }

  async getProvider(profileId: string): Promise<ProviderProfile | undefined> {
    const config = await this.load();
    const stored = config.providers.find((entry) => entry.id === profileId);
    if (!stored) return undefined;
    return {
      id: stored.id,
      kind: stored.kind,
      providerId: stored.providerId,
      secrets: Object.fromEntries(
        Object.entries(stored.secrets).map(([key, value]) => [
          key,
          this.#protector.reveal(value),
        ]),
      ),
      values: structuredClone(stored.values),
    };
  }

  async removeProvider(profileId: string): Promise<StoredClientConfig> {
    return this.update((config) => {
      const dictation = { ...config.dictation };
      if (dictation.activeSpeechProviderProfileId === profileId) {
        delete dictation.activeSpeechProviderProfileId;
      }
      if (dictation.activeTextProviderProfileId === profileId) {
        delete dictation.activeTextProviderProfileId;
      }
      return {
        ...config,
        dictation,
        providers: config.providers.filter((entry) => entry.id !== profileId),
      };
    });
  }

  private async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.#queue.then(operation);
    this.#queue = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }

  private async readFromDisk(): Promise<ParsedConfig> {
    try {
      return parseConfig(await readFile(this.#configPath, 'utf8'));
    } catch (error) {
      if (
        isRecord(error) &&
        'code' in error &&
        (error as { code?: unknown }).code === 'ENOENT'
      ) {
        return { config: defaultConfig(), migrated: false };
      }
      throw error;
    }
  }

  private async writeAtomically(config: StoredClientConfig): Promise<void> {
    const directory = path.dirname(this.#configPath);
    const temporaryPath = `${this.#configPath}.${process.pid}.${randomUUID()}.tmp`;
    await mkdir(directory, { recursive: true });
    try {
      await writeFile(temporaryPath, serializeConfig(config), {
        encoding: 'utf8',
        mode: 0o600,
      });
      await rename(temporaryPath, this.#configPath);
    } catch (error) {
      await rm(temporaryPath, { force: true });
      throw error;
    }
  }
}
