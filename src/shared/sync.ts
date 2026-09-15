export const SYNC_PROVIDER_IDS = ['s3', 'webdav'] as const;

export type SyncProviderId = (typeof SYNC_PROVIDER_IDS)[number];

export const SYNC_STATUSES = ['success', 'error'] as const;

export type SyncStatus = (typeof SYNC_STATUSES)[number];

export const SYNC_BACKUP_CODE_MIN_LENGTH = 8;
export const SYNC_BACKUP_CODE_MAX_LENGTH = 32;
export const SYNC_BACKUP_CODE_GENERATED_LENGTH = 8;
export const SYNC_HISTORY_LIMIT = 5;

export interface SyncBackupInfo {
  createdAt: number;
  deviceName: string;
  name: string;
  path: string;
  size: number;
}

export interface ClientSyncS3Snapshot {
  accessKeyConfigured: boolean;
  bucket: string;
  endpoint: string;
  forcePathStyle: boolean;
  prefix: string;
  region: string;
  secretAccessKeyConfigured: boolean;
}

export interface ClientSyncWebDavSnapshot {
  basePath: string;
  passwordConfigured: boolean;
  url: string;
  username: string;
}

export interface ClientSyncLogEntry {
  at: number;
  error?: string;
  recordsMerged?: number;
  status: SyncStatus;
}

export interface ClientSyncSnapshot {
  backupCodeConfigured: boolean;
  customBackupCode: boolean;
  enabled: boolean;
  lastSyncAt?: number;
  lastSyncError?: string;
  lastSyncStatus?: SyncStatus;
  providerId?: SyncProviderId;
  recentResults: readonly ClientSyncLogEntry[];
  s3?: ClientSyncS3Snapshot;
  webdav?: ClientSyncWebDavSnapshot;
}

export interface ClientSyncS3Update {
  accessKeyId?: string;
  bucket?: string;
  endpoint?: string;
  forcePathStyle?: boolean;
  prefix?: string;
  region?: string;
  secretAccessKey?: string;
}

export interface ClientSyncWebDavUpdate {
  basePath?: string;
  password?: string;
  url?: string;
  username?: string;
}

export interface ClientSyncConfigUpdate {
  backupCode?: string;
  enabled?: boolean;
  generateBackupCode?: boolean;
  providerId?: SyncProviderId;
  s3?: ClientSyncS3Update;
  webdav?: ClientSyncWebDavUpdate;
}

export interface ClientSyncResult {
  error?: string;
  recordsMerged?: number;
  success: boolean;
  uploadedAt?: number;
}
