import type { SyncProviderId } from '../../shared/sync.js';

export interface RemoteSyncObjectInfo {
  lastModified: number;
  name: string;
  path: string;
  size: number;
}

export interface SyncStorageProvider {
  readonly displayName: string;
  readonly id: SyncProviderId;
  delete(remotePath: string): Promise<void>;
  download(remotePath: string): Promise<Buffer>;
  list(remoteDirectory: string): Promise<readonly RemoteSyncObjectInfo[]>;
  testConnection(): Promise<void>;
  upload(remotePath: string, data: Buffer): Promise<void>;
}

export interface S3StorageSettings {
  accessKeyId: string;
  bucket: string;
  endpoint: string;
  forcePathStyle: boolean;
  prefix: string;
  region: string;
  secretAccessKey: string;
}

export interface WebDavStorageSettings {
  basePath: string;
  password: string;
  url: string;
  username: string;
}

const privateHostPattern =
  /^(localhost|127(?:\.\d{1,3}){3}|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|\[?::1\]?|\[?f[cd][0-9a-f:]+\]?|[^.]+\.local)$/iu;

export const normalizeSyncUrl = (value: string, allowInsecurePrivateEndpoint: boolean): string => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Storage endpoint is not a valid URL');
  }
  if (
    url.protocol !== 'https:' &&
    !(
      allowInsecurePrivateEndpoint &&
      url.protocol === 'http:' &&
      privateHostPattern.test(url.hostname)
    )
  ) {
    throw new Error(
      'Storage endpoints must use HTTPS unless explicit private-network access is enabled',
    );
  }
  if (url.username || url.password) {
    throw new Error('Storage endpoints cannot contain embedded credentials');
  }
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/u, '');
};

export const normalizeRemoteDirectory = (value: string): string => {
  const trimmed = value.trim().replaceAll('\\', '/');
  const withoutDots = trimmed
    .split('/')
    .filter((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
    .join('/');
  return withoutDots;
};

export const joinRemotePath = (directory: string, fileName: string): string => {
  const safeDirectory = normalizeRemoteDirectory(directory);
  const safeName = fileName.replaceAll('\\', '/').split('/').pop() ?? '';
  if (!safeName || safeName === '.' || safeName === '..') {
    throw new Error('Remote file name is invalid');
  }
  return safeDirectory ? `${safeDirectory}/${safeName}` : safeName;
};

export const isUntypoSyncObjectName = (name: string): boolean => {
  return name.toLowerCase().endsWith('.untypo');
};
