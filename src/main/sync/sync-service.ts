import { hostname } from 'node:os';
import {
  SYNC_HISTORY_LIMIT,
  type ClientSyncConfigUpdate,
  type ClientSyncLogEntry,
  type ClientSyncResult,
  type ClientSyncSnapshot,
  type SyncBackupInfo,
} from '../../shared/sync.js';
import { generateBackupCode, parseBackupCode } from './backup-code.js';
import {
  createBackupFileName,
  normalizeBackupDeviceName,
  parseBackupFileName,
} from './backup-name.js';
import { mergeSyncState, parseSyncPayload } from './merger.js';
import { packSyncFile, unpackSyncFile, UNTYPO_FILE_VERSION } from './packer.js';
import { S3StorageProvider } from './providers/s3-provider.js';
import { WebDavStorageProvider } from './providers/webdav-provider.js';
import {
  joinRemotePath,
  normalizeRemoteDirectory,
  type SyncStorageProvider,
} from './storage-provider.js';
import type {
  ConfigurationService,
  StoredSyncConfig,
  StoredSyncLogEntry,
} from '../storage/config-store.js';
import type { HistoryRepository } from '../storage/history.js';

const DEFAULT_S3_PREFIX = 'untypo/';
const DEFAULT_WEBDAV_BASE_PATH = '/untypo/';

export interface SyncServiceOptions {
  appVersion: string;
  configuration: ConfigurationService;
  history: HistoryRepository;
}

const emptySyncConfig = (): StoredSyncConfig => ({ enabled: false });

const describeError = (error: unknown): string =>
  error instanceof Error && error.message.length > 0 ? error.message : 'Cloud sync failed';

const toLogEntry = (entry: StoredSyncLogEntry): ClientSyncLogEntry => ({
  at: entry.at,
  status: entry.status,
  ...(entry.error ? { error: entry.error } : {}),
  ...(typeof entry.recordsMerged === 'number' ? { recordsMerged: entry.recordsMerged } : {}),
});

export class SyncService {
  readonly #appVersion: string;
  readonly #configuration: ConfigurationService;
  readonly #history: HistoryRepository;

  constructor(options: SyncServiceOptions) {
    this.#appVersion = options.appVersion;
    this.#configuration = options.configuration;
    this.#history = options.history;
  }

  async generateBackupCode(): Promise<string> {
    const code = generateBackupCode();
    await this.#configuration.update((config) => ({
      ...config,
      sync: {
        ...(config.sync ?? emptySyncConfig()),
        backupCodeMode: 'generated',
        encryptedBackupCode: this.#configuration.protectSecret(code),
      },
    }));
    return code;
  }

  async snapshot(): Promise<ClientSyncSnapshot> {
    const config = await this.#configuration.load();
    return this.toSnapshot(config.sync);
  }

  async updateConfig(update: ClientSyncConfigUpdate): Promise<ClientSyncSnapshot> {
    const next = await this.#configuration.update((config) => {
      const current = structuredClone(config.sync ?? emptySyncConfig());
      const nextSync: StoredSyncConfig = {
        ...current,
        enabled: update.enabled ?? current.enabled,
      };
      if (update.providerId) nextSync.providerId = update.providerId;
      if (update.s3) {
        nextSync.s3 = {
          bucket: update.s3.bucket ?? current.s3?.bucket ?? '',
          endpoint: update.s3.endpoint ?? current.s3?.endpoint ?? '',
          prefix: update.s3.prefix ?? current.s3?.prefix ?? DEFAULT_S3_PREFIX,
          region: update.s3.region ?? current.s3?.region ?? '',
          ...(update.s3.forcePathStyle === undefined
            ? current.s3?.forcePathStyle === undefined
              ? {}
              : { forcePathStyle: current.s3.forcePathStyle }
            : { forcePathStyle: update.s3.forcePathStyle }),
          ...(current.s3?.accessKeyId ? { accessKeyId: current.s3.accessKeyId } : {}),
          ...(current.s3?.secretAccessKey ? { secretAccessKey: current.s3.secretAccessKey } : {}),
        };
        if (update.s3.accessKeyId !== undefined) {
          if (update.s3.accessKeyId.trim().length === 0) {
            delete nextSync.s3.accessKeyId;
          } else {
            nextSync.s3.accessKeyId = this.#configuration.protectSecret(update.s3.accessKeyId);
          }
        }
        if (update.s3.secretAccessKey !== undefined) {
          if (update.s3.secretAccessKey.trim().length === 0) {
            delete nextSync.s3.secretAccessKey;
          } else {
            nextSync.s3.secretAccessKey = this.#configuration.protectSecret(
              update.s3.secretAccessKey,
            );
          }
        }
      }
      if (update.webdav) {
        nextSync.webdav = {
          basePath: update.webdav.basePath ?? current.webdav?.basePath ?? DEFAULT_WEBDAV_BASE_PATH,
          url: update.webdav.url ?? current.webdav?.url ?? '',
          username: update.webdav.username ?? current.webdav?.username ?? '',
          ...(current.webdav?.password ? { password: current.webdav.password } : {}),
        };
        if (update.webdav.password !== undefined) {
          if (update.webdav.password.trim().length === 0) {
            delete nextSync.webdav.password;
          } else {
            nextSync.webdav.password = this.#configuration.protectSecret(update.webdav.password);
          }
        }
      }
      if (update.generateBackupCode) {
        nextSync.backupCodeMode = 'generated';
        nextSync.encryptedBackupCode = this.#configuration.protectSecret(generateBackupCode());
      } else if (update.backupCode !== undefined) {
        nextSync.backupCodeMode = 'custom';
        nextSync.encryptedBackupCode = this.#configuration.protectSecret(
          parseBackupCode(update.backupCode),
        );
      }
      return { ...config, sync: nextSync };
    });
    return this.toSnapshot(next.sync);
  }

  async testConnection(): Promise<void> {
    const { provider } = await this.requireProvider();
    await provider.testConnection();
  }

  async listRemoteBackups(): Promise<readonly SyncBackupInfo[]> {
    const { provider } = await this.requireProvider();
    const objects = await provider.list('');
    return objects
      .map((object): SyncBackupInfo => {
        const metadata = parseBackupFileName(object.name);
        return {
          createdAt: metadata?.createdAt ?? object.lastModified,
          deviceName: metadata?.deviceName ?? '',
          name: object.name,
          path: object.path,
          size: object.size,
        };
      })
      .sort((left, right) => right.createdAt - left.createdAt);
  }

  async createBackup(): Promise<ClientSyncResult> {
    try {
      const config = await this.#configuration.load();
      if (config.sync?.enabled !== true) {
        throw new Error('Cloud sync is disabled');
      }
      const { directory, provider } = await this.requireProvider();
      const backupCode = await this.requireBackupCode();
      const at = Date.now();
      const deviceName = normalizeBackupDeviceName(hostname());
      const packed = await this.packCurrentState(backupCode, at, deviceName);
      const remotePath = joinRemotePath(directory, createBackupFileName(at, deviceName));
      await provider.upload(remotePath, packed);
      await this.recordResult({ at, status: 'success' });
      return { success: true, uploadedAt: at };
    } catch (error) {
      const message = describeError(error);
      await this.recordResult({
        at: Date.now(),
        error: message,
        status: 'error',
      });
      return { error: message, success: false };
    }
  }

  async applyBackup(remoteFile: string): Promise<ClientSyncResult> {
    try {
      const { provider } = await this.requireProvider();
      await this.assertKnownBackup(provider, remoteFile);
      const backupCode = await this.requireBackupCode();
      const packed = await provider.download(remoteFile);
      const payload = await unpackSyncFile(packed, backupCode);
      const remote = parseSyncPayload(payload);
      const config = await this.#configuration.load();
      const [profile, dictionaryLearning, personalizationLearning] = await Promise.all([
        this.#configuration.getProfile(),
        this.#configuration.getDictionaryLearningState(),
        this.#configuration.getPersonalizationState(),
      ]);
      const merged = mergeSyncState(
        {
          dictionary: config.dictionary,
          dictionaryLearning,
          personalization: config.personalization,
          personalizationLearning,
          ...(profile ? { profile } : {}),
          profileUpdatedAt: config.sync?.lastSyncAt ?? 0,
        },
        remote,
        this.#history.listAll(),
      );
      await this.#configuration.update((current) => ({
        ...current,
        dictionary: merged.dictionary,
        personalization: {
          ...current.personalization,
          applicationStyles: merged.personalization.applicationStyles,
          learningEnabled: merged.personalization.learningEnabled,
        },
      }));
      await this.#configuration.setProfile(merged.profile);
      await this.#configuration.replaceDictionaryLearningState(merged.dictionaryLearning);
      await this.#configuration.replacePersonalizationLearningState(merged.personalizationLearning);
      const recordsMerged = this.#history.importMissing(merged.history);
      const at = Date.now();
      await this.recordResult({
        at,
        recordsMerged,
        status: 'success',
      });
      return { recordsMerged, success: true, uploadedAt: at };
    } catch (error) {
      const message = describeError(error);
      await this.recordResult({
        at: Date.now(),
        error: message,
        status: 'error',
      });
      return { error: message, success: false };
    }
  }

  async deleteBackup(remoteFile: string): Promise<void> {
    const { provider } = await this.requireProvider();
    await this.assertKnownBackup(provider, remoteFile);
    await provider.delete(remoteFile);
  }

  private async packCurrentState(
    backupCode: string,
    exportedAt: number,
    deviceName: string,
  ): Promise<Buffer> {
    const config = await this.#configuration.load();
    const [profile, dictionaryLearning, personalizationLearning] = await Promise.all([
      this.#configuration.getProfile(),
      this.#configuration.getDictionaryLearningState(),
      this.#configuration.getPersonalizationState(),
    ]);
    return await packSyncFile(
      {
        deviceName,
        dictionary: config.dictionary,
        dictionaryLearningState: dictionaryLearning,
        exportedAt,
        history: this.#history.listAll(),
        personalization: {
          applicationStyles: config.personalization.applicationStyles,
          learningEnabled: config.personalization.learningEnabled,
          learningState: personalizationLearning,
        },
        ...(profile ? { profile } : {}),
        version: UNTYPO_FILE_VERSION,
      },
      backupCode,
      { appVersion: this.#appVersion, createdAt: exportedAt },
    );
  }

  private async assertKnownBackup(
    provider: SyncStorageProvider,
    remoteFile: string,
  ): Promise<void> {
    if (!remoteFile.toLowerCase().endsWith('.untypo')) {
      throw new Error('Remote backup path is invalid');
    }
    const objects = await provider.list('');
    const paths = new Set(objects.map((object) => object.path));
    if (!paths.has(remoteFile)) {
      throw new Error('Remote backup does not exist');
    }
  }

  private async requireBackupCode(): Promise<string> {
    const config = await this.#configuration.load();
    const encrypted = config.sync?.encryptedBackupCode;
    if (!encrypted) throw new Error('Backup code is not configured');
    return parseBackupCode(this.#configuration.revealSecret(encrypted));
  }

  private async requireProvider(): Promise<{
    directory: string;
    provider: SyncStorageProvider;
  }> {
    const config = await this.#configuration.load();
    const sync = config.sync;
    if (!sync?.providerId) throw new Error('Cloud storage is not configured');
    if (sync.providerId === 's3') {
      const settings = sync.s3;
      if (
        !settings?.endpoint ||
        !settings.bucket ||
        !settings.accessKeyId ||
        !settings.secretAccessKey
      ) {
        throw new Error('S3 storage is incomplete');
      }
      return {
        directory: normalizeRemoteDirectory(settings.prefix || DEFAULT_S3_PREFIX),
        provider: new S3StorageProvider({
          accessKeyId: this.#configuration.revealSecret(settings.accessKeyId),
          bucket: settings.bucket,
          endpoint: settings.endpoint,
          forcePathStyle: settings.forcePathStyle === true,
          prefix: settings.prefix || DEFAULT_S3_PREFIX,
          region: settings.region,
          secretAccessKey: this.#configuration.revealSecret(settings.secretAccessKey),
        }),
      };
    }
    const settings = sync.webdav;
    if (!settings?.url || !settings.username || !settings.password) {
      throw new Error('WebDAV storage is incomplete');
    }
    return {
      directory: normalizeRemoteDirectory(settings.basePath || DEFAULT_WEBDAV_BASE_PATH),
      provider: new WebDavStorageProvider({
        basePath: settings.basePath || DEFAULT_WEBDAV_BASE_PATH,
        password: this.#configuration.revealSecret(settings.password),
        url: settings.url,
        username: settings.username,
      }),
    };
  }

  private async recordResult(entry: StoredSyncLogEntry): Promise<void> {
    await this.#configuration.update((config) => {
      const current = structuredClone(config.sync ?? emptySyncConfig());
      const recentResults = [entry, ...(current.recentResults ?? [])].slice(0, SYNC_HISTORY_LIMIT);
      const nextSync: StoredSyncConfig = {
        ...current,
        lastSyncAt: entry.at,
        lastSyncStatus: entry.status,
        recentResults,
      };
      if (entry.error) nextSync.lastSyncError = entry.error;
      else delete nextSync.lastSyncError;
      return { ...config, sync: nextSync };
    });
  }

  private toSnapshot(sync?: StoredSyncConfig): ClientSyncSnapshot {
    const recentResults = (sync?.recentResults ?? []).map(toLogEntry);
    return {
      backupCodeConfigured: Boolean(sync?.encryptedBackupCode),
      customBackupCode: sync?.backupCodeMode === 'custom',
      enabled: sync?.enabled === true,
      recentResults,
      ...(sync?.lastSyncAt === undefined ? {} : { lastSyncAt: sync.lastSyncAt }),
      ...(sync?.lastSyncError ? { lastSyncError: sync.lastSyncError } : {}),
      ...(sync?.lastSyncStatus ? { lastSyncStatus: sync.lastSyncStatus } : {}),
      ...(sync?.providerId ? { providerId: sync.providerId } : {}),
      ...(sync?.s3
        ? {
            s3: {
              accessKeyConfigured: Boolean(sync.s3.accessKeyId),
              bucket: sync.s3.bucket,
              endpoint: sync.s3.endpoint,
              forcePathStyle: sync.s3.forcePathStyle === true,
              prefix: sync.s3.prefix,
              region: sync.s3.region,
              secretAccessKeyConfigured: Boolean(sync.s3.secretAccessKey),
            },
          }
        : {}),
      ...(sync?.webdav
        ? {
            webdav: {
              basePath: sync.webdav.basePath,
              passwordConfigured: Boolean(sync.webdav.password),
              url: sync.webdav.url,
              username: sync.webdav.username,
            },
          }
        : {}),
    };
  }
}
