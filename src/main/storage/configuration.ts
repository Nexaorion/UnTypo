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
import type { EncryptedValue, SecretProtector } from './secret-protector.js';

export type HotkeyMode = 'push-to-talk' | 'toggle';
export interface HistoryPolicy {
  enabled: boolean;
  retentionDays: number;
}

export interface StoredProviderProfile {
  id: string;
  kind: ModelProviderKind;
  providerId: ModelProviderId;
  secrets: Readonly<Record<string, EncryptedValue>>;
  values: Readonly<ClientProviderValues>;
}

export interface StoredClientConfig {
  version: 2;
  general: {
    launchAtLogin: boolean;
    locale: SupportedLanguage;
  };
  dictation: {
    activeSpeechProviderProfileId?: string;
    activeTextProviderProfileId?: string;
    defaultTargetLanguage: SupportedLanguage;
    hotkeyAccelerator: string;
    hotkeyMode: HotkeyMode;
    language: SupportedLanguage;
  };
  dictionary: readonly string[];
  encryptedProfile?: EncryptedValue;
  history: HistoryPolicy;
  providers: readonly StoredProviderProfile[];
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

const defaultConfig = (): StoredClientConfig => ({
  version: 2,
  general: {
    launchAtLogin: false,
    locale: 'zh-CN',
  },
  dictation: {
    defaultTargetLanguage: 'en-US',
    hotkeyAccelerator: 'Ctrl+Shift+Space',
    hotkeyMode: 'push-to-talk',
    language: 'zh-CN',
  },
  dictionary: [],
  history: {
    enabled: true,
    retentionDays: 30,
  },
  providers: [],
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

const parseDictionary = (value: unknown): readonly string[] => {
  if (
    !Array.isArray(value) ||
    !value.every((entry) => typeof entry === 'string')
  ) {
    throw new Error('Invalid dictionary');
  }
  return [...value] as string[];
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
  'dictionary' | 'encryptedProfile' | 'general' | 'history'
> => {
  const encryptedProfile = parseEncryptedProfile(value);
  return {
    dictionary: parseDictionary(value.dictionary),
    ...(encryptedProfile ? { encryptedProfile } : {}),
    general: parseGeneral(value.general),
    history: parseHistory(value.history),
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
    (dictation.hotkeyMode !== 'push-to-talk' &&
      dictation.hotkeyMode !== 'toggle') ||
    (dictation.activeSpeechProviderProfileId !== undefined &&
      (!isNonEmptyString(dictation.activeSpeechProviderProfileId, 64) ||
        !profileIdPattern.test(dictation.activeSpeechProviderProfileId))) ||
    (dictation.activeTextProviderProfileId !== undefined &&
      (!isNonEmptyString(dictation.activeTextProviderProfileId, 64) ||
        !profileIdPattern.test(dictation.activeTextProviderProfileId))) ||
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
    version: 2,
    ...parseCommonData(value),
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
      hotkeyAccelerator: dictation.hotkeyAccelerator,
      hotkeyMode: dictation.hotkeyMode,
      language: assertLanguage(dictation.language, 'dictation language'),
    },
    providers,
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
    version: 2,
    ...parseCommonData(value),
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
      hotkeyAccelerator: dictation.hotkeyAccelerator,
      hotkeyMode: dictation.hotkeyMode,
      language: assertLanguage(dictation.language, 'dictation language'),
    },
    providers,
  };
};

const parseConfig = (source: string): ParsedConfig => {
  const value: unknown = JSON.parse(source);
  if (!isRecord(value)) throw new Error('Invalid configuration data');
  if (value.version === 2) {
    return { config: parseV2Config(value), migrated: false };
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

  async setDictionary(entries: readonly string[]): Promise<StoredClientConfig> {
    const normalized = [
      ...new Set(entries.map((entry) => entry.trim())),
    ].filter(Boolean);
    return this.update((config) => ({ ...config, dictionary: normalized }));
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
