import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  isUntypoSyncObjectName,
  joinRemotePath,
  normalizeRemoteDirectory,
  normalizeSyncUrl,
  type RemoteSyncObjectInfo,
  type S3StorageSettings,
  type SyncStorageProvider,
} from '../storage-provider.js';

const streamToBuffer = async (body: unknown): Promise<Buffer> => {
  if (body === undefined || body === null) {
    throw new Error('Remote file is empty');
  }
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (typeof body === 'string') return Buffer.from(body, 'utf8');
  if (
    typeof body === 'object' &&
    'transformToByteArray' in body &&
    typeof (body as { transformToByteArray?: unknown }).transformToByteArray ===
      'function'
  ) {
    const bytes = await (
      body as { transformToByteArray: () => Promise<Uint8Array> }
    ).transformToByteArray();
    return Buffer.from(bytes);
  }
  throw new Error('Remote file could not be read');
};

export class S3StorageProvider implements SyncStorageProvider {
  readonly displayName = 'Amazon S3';
  readonly id = 's3' as const;
  readonly #bucket: string;
  readonly #client: S3Client;
  readonly #prefix: string;

  constructor(settings: S3StorageSettings) {
    const endpoint = normalizeSyncUrl(settings.endpoint, true);
    const bucket = settings.bucket.trim();
    if (!bucket) throw new Error('S3 bucket is required');
    this.#bucket = bucket;
    this.#prefix = normalizeRemoteDirectory(settings.prefix);
    this.#client = new S3Client({
      credentials: {
        accessKeyId: settings.accessKeyId,
        secretAccessKey: settings.secretAccessKey,
      },
      endpoint,
      forcePathStyle: settings.forcePathStyle,
      region: settings.region.trim() || 'us-east-1',
    });
  }

  async testConnection(): Promise<void> {
    await this.#client.send(new HeadBucketCommand({ Bucket: this.#bucket }));
  }

  async upload(remotePath: string, data: Buffer): Promise<void> {
    await this.#client.send(
      new PutObjectCommand({
        Body: data,
        Bucket: this.#bucket,
        ContentType: 'application/octet-stream',
        Key: this.resolveKey(remotePath),
      }),
    );
  }

  async download(remotePath: string): Promise<Buffer> {
    const result = await this.#client.send(
      new GetObjectCommand({
        Bucket: this.#bucket,
        Key: this.resolveKey(remotePath),
      }),
    );
    return streamToBuffer(result.Body);
  }

  async list(
    remoteDirectory: string,
  ): Promise<readonly RemoteSyncObjectInfo[]> {
    const prefix = this.resolveDirectory(remoteDirectory);
    const listed: RemoteSyncObjectInfo[] = [];
    let continuationToken: string | undefined;
    do {
      const result = await this.#client.send(
        new ListObjectsV2Command({
          Bucket: this.#bucket,
          ContinuationToken: continuationToken,
          Prefix: prefix,
        }),
      );
      for (const object of result.Contents ?? []) {
        const key = object.Key;
        if (!key) continue;
        const name = key.split('/').pop() ?? key;
        if (!isUntypoSyncObjectName(name)) continue;
        listed.push({
          lastModified: object.LastModified?.getTime() ?? 0,
          name,
          path: key,
          size: object.Size ?? 0,
        });
      }
      continuationToken = result.IsTruncated
        ? result.NextContinuationToken
        : undefined;
    } while (continuationToken);
    return listed.sort((left, right) => right.lastModified - left.lastModified);
  }

  async delete(remotePath: string): Promise<void> {
    await this.#client.send(
      new DeleteObjectCommand({
        Bucket: this.#bucket,
        Key: this.resolveKey(remotePath),
      }),
    );
  }

  private resolveDirectory(remoteDirectory: string): string {
    const directory = normalizeRemoteDirectory(remoteDirectory);
    const combined = directory
      ? joinRemotePath(this.#prefix, directory)
      : this.#prefix;
    return combined ? `${combined}/` : '';
  }

  private resolveKey(remotePath: string): string {
    const normalized = normalizeRemoteDirectory(remotePath);
    if (!normalized) throw new Error('Remote path is invalid');
    if (this.#prefix && !normalized.startsWith(`${this.#prefix}/`)) {
      return joinRemotePath(this.#prefix, normalized);
    }
    return normalized;
  }
}
