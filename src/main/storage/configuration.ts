import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  SupportedLanguage,
  UserProfileContext,
} from '../../core/providers/contracts.js';
import type { ClientJsonValue } from '../../shared/ipc.js';
import type { EncryptedValue, SecretProtector } from './secret-protector.js';

export type HotkeyMode = 'push-to-talk' | 'toggle';
export interface HistoryPolicy {
  enabled: boolean;
  retentionDays: number;
}

export interface StoredProviderProfile {
  id: string;
  providerId: string;
  secrets: Readonly<Record<string, EncryptedValue>>;
  values: Readonly<Record<string, ClientJsonValue>>;
}

export interface StoredClientConfig {
  version: 1;
  general: {
    launchAtLogin: boolean;
    locale: SupportedLanguage;
  };
  dictation: {
    activeProviderProfileId?: string;
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
  providerId: string;
  secrets: Readonly<Record<string, string>>;
  values: Readonly<Record<string, ClientJsonValue>>;
}

const defaultConfig = (): StoredClientConfig => ({
  version: 1,
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

const assertLanguage = (value: unknown, field: string): void => {
  if (value !== 'zh-CN' && value !== 'en-US') {
    throw new Error(`Invalid ${field}`);
  }
};

const parseConfig = (source: string): StoredClientConfig => {
  const value: unknown = JSON.parse(source);
  if (!isRecord(value) || value.version !== 1) {
    throw new Error('Unsupported configuration version');
  }
  if (
    !isRecord(value.general) ||
    typeof value.general.launchAtLogin !== 'boolean'
  ) {
    throw new Error('Invalid general settings');
  }
  assertLanguage(value.general.locale, 'locale');

  if (
    !isRecord(value.dictation) ||
    typeof value.dictation.hotkeyAccelerator !== 'string' ||
    (value.dictation.hotkeyMode !== 'push-to-talk' &&
      value.dictation.hotkeyMode !== 'toggle')
  ) {
    throw new Error('Invalid dictation settings');
  }
  assertLanguage(value.dictation.language, 'dictation language');
  assertLanguage(
    value.dictation.defaultTargetLanguage,
    'default target language',
  );
  if (
    'activeProviderProfileId' in value.dictation &&
    typeof value.dictation.activeProviderProfileId !== 'string'
  ) {
    throw new Error('Invalid active provider profile');
  }

  if (
    !Array.isArray(value.dictionary) ||
    !value.dictionary.every((entry) => typeof entry === 'string') ||
    !Array.isArray(value.providers) ||
    !isRecord(value.history) ||
    typeof value.history.enabled !== 'boolean' ||
    typeof value.history.retentionDays !== 'number' ||
    value.history.retentionDays < 0
  ) {
    throw new Error('Invalid configuration data');
  }

  return value as unknown as StoredClientConfig;
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
    await this.#queue;
    return structuredClone(await this.readFromDisk());
  }

  async update(
    mutate: (config: StoredClientConfig) => StoredClientConfig,
  ): Promise<StoredClientConfig> {
    return this.runExclusive(async () => {
      const current = await this.readFromDisk();
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
    const secrets = Object.fromEntries(
      Object.entries(profile.secrets).map(([key, value]) => [
        key,
        this.#protector.protect(value),
      ]),
    );
    const stored: StoredProviderProfile = {
      id: profile.id,
      providerId: profile.providerId,
      secrets,
      values: structuredClone(profile.values),
    };

    return this.update((config) => ({
      ...config,
      providers: [
        ...config.providers.filter((entry) => entry.id !== profile.id),
        stored,
      ],
    }));
  }

  async getProvider(profileId: string): Promise<ProviderProfile | undefined> {
    const config = await this.load();
    const stored = config.providers.find((entry) => entry.id === profileId);
    if (!stored) return undefined;
    return {
      id: stored.id,
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
    return this.update((config) => ({
      ...config,
      providers: config.providers.filter((entry) => entry.id !== profileId),
    }));
  }

  private async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.#queue.then(operation);
    this.#queue = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }

  private async readFromDisk(): Promise<StoredClientConfig> {
    try {
      return parseConfig(await readFile(this.#configPath, 'utf8'));
    } catch (error) {
      if (
        isRecord(error) &&
        'code' in error &&
        (error as { code?: unknown }).code === 'ENOENT'
      ) {
        return defaultConfig();
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
