import {
  isUntypoSyncObjectName,
  joinRemotePath,
  normalizeRemoteDirectory,
  normalizeSyncUrl,
  type RemoteSyncObjectInfo,
  type SyncStorageProvider,
  type WebDavStorageSettings,
} from '../storage-provider.js';

interface WebDavFileStat {
  basename: string;
  filename: string;
  lastmod: string;
  size: number;
  type: string;
}

interface WebDavClient {
  createDirectory: (path: string, options?: { recursive?: boolean }) => Promise<unknown>;
  deleteFile: (path: string) => Promise<unknown>;
  exists: (path: string) => Promise<boolean>;
  getDirectoryContents: (
    path: string,
    options?: { deep?: boolean },
  ) => Promise<WebDavFileStat[] | { file?: boolean }>;
  getFileContents: (path: string, options?: { format?: 'binary' }) => Promise<unknown>;
  putFileContents: (
    path: string,
    data: Buffer,
    options?: { overwrite?: boolean },
  ) => Promise<unknown>;
}

const asDirectory = (value: string): string => {
  const normalized = normalizeRemoteDirectory(value);
  return normalized ? `/${normalized}/` : '/';
};

export class WebDavStorageProvider implements SyncStorageProvider {
  readonly displayName = 'WebDAV';
  readonly id = 'webdav' as const;
  readonly #basePath: string;
  readonly #password: string;
  readonly #url: string;
  readonly #username: string;
  #client?: WebDavClient;

  constructor(settings: WebDavStorageSettings) {
    this.#url = normalizeSyncUrl(settings.url, true);
    this.#basePath = normalizeRemoteDirectory(settings.basePath);
    this.#password = settings.password;
    this.#username = settings.username;
  }

  async testConnection(): Promise<void> {
    const client = await this.client();
    const directory = asDirectory(this.#basePath);
    const exists = await client.exists(directory);
    if (exists) return;
    await client.createDirectory(directory, { recursive: true });
  }

  async upload(remotePath: string, data: Buffer): Promise<void> {
    const client = await this.client();
    const path = this.resolvePath(remotePath);
    const parent = path.slice(0, path.lastIndexOf('/') + 1);
    if (parent && parent !== '/') {
      const exists = await client.exists(parent);
      if (!exists) {
        await client.createDirectory(parent, { recursive: true });
      }
    }
    await client.putFileContents(path, data, { overwrite: true });
  }

  async download(remotePath: string): Promise<Buffer> {
    const contents = await (
      await this.client()
    ).getFileContents(this.resolvePath(remotePath), { format: 'binary' });
    if (Buffer.isBuffer(contents)) return contents;
    if (contents instanceof ArrayBuffer) return Buffer.from(contents);
    if (contents instanceof Uint8Array) return Buffer.from(contents);
    throw new Error('Remote file could not be read');
  }

  async list(remoteDirectory: string): Promise<readonly RemoteSyncObjectInfo[]> {
    const directory = asDirectory(
      remoteDirectory ? joinRemotePath(this.#basePath, remoteDirectory) : this.#basePath,
    );
    const client = await this.client();
    const exists = await client.exists(directory);
    if (!exists) return [];
    const entries = await client.getDirectoryContents(directory, {
      deep: false,
    });
    const listed: RemoteSyncObjectInfo[] = [];
    for (const entry of Array.isArray(entries) ? entries : []) {
      if (entry.type !== 'file') continue;
      const name = entry.basename;
      if (!isUntypoSyncObjectName(name)) continue;
      listed.push({
        lastModified: Date.parse(entry.lastmod) || 0,
        name,
        path: entry.filename.replace(/^\/+/u, ''),
        size: entry.size,
      });
    }
    return listed.sort((left, right) => right.lastModified - left.lastModified);
  }

  async delete(remotePath: string): Promise<void> {
    await (await this.client()).deleteFile(this.resolvePath(remotePath));
  }

  private async client(): Promise<WebDavClient> {
    if (this.#client) return this.#client;
    const module = (await import('webdav')) as {
      createClient: (url: string, options: { password: string; username: string }) => WebDavClient;
    };
    this.#client = module.createClient(this.#url, {
      password: this.#password,
      username: this.#username,
    });
    return this.#client;
  }

  private resolvePath(remotePath: string): string {
    const normalized = normalizeRemoteDirectory(remotePath);
    if (!normalized) throw new Error('Remote path is invalid');
    if (this.#basePath && !normalized.startsWith(`${this.#basePath}/`)) {
      return `/${joinRemotePath(this.#basePath, normalized)}`;
    }
    return `/${normalized}`;
  }
}
