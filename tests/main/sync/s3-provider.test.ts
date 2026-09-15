import { beforeEach, describe, expect, it, vi } from 'vitest';

const send = vi.fn();

vi.mock('@aws-sdk/client-s3', () => ({
  DeleteObjectCommand: class {
    constructor(public readonly input: unknown) {}
  },
  GetObjectCommand: class {
    constructor(public readonly input: unknown) {}
  },
  HeadBucketCommand: class {
    constructor(public readonly input: unknown) {}
  },
  ListObjectsV2Command: class {
    constructor(public readonly input: unknown) {}
  },
  PutObjectCommand: class {
    constructor(public readonly input: unknown) {}
  },
  S3Client: class {
    send = send;
  },
}));

import { S3StorageProvider } from '../../../src/main/sync/providers/s3-provider';

describe('S3StorageProvider', () => {
  beforeEach(() => {
    send.mockReset();
  });

  it('lists only .untypo objects under the configured prefix', async () => {
    send.mockResolvedValueOnce({
      Contents: [
        {
          Key: 'untypo/keep.untypo',
          LastModified: new Date(200),
          Size: 12,
        },
        {
          Key: 'untypo/notes.txt',
          LastModified: new Date(300),
          Size: 4,
        },
      ],
    });
    const provider = new S3StorageProvider({
      accessKeyId: 'key',
      bucket: 'backups',
      endpoint: 'https://s3.example.test',
      forcePathStyle: true,
      prefix: 'untypo/',
      region: 'us-east-1',
      secretAccessKey: 'secret',
    });
    await expect(provider.list('')).resolves.toEqual([
      {
        lastModified: 200,
        name: 'keep.untypo',
        path: 'untypo/keep.untypo',
        size: 12,
      },
    ]);
  });

  it('uploads to the resolved object key', async () => {
    send.mockResolvedValueOnce({});
    const provider = new S3StorageProvider({
      accessKeyId: 'key',
      bucket: 'backups',
      endpoint: 'https://s3.example.test',
      forcePathStyle: false,
      prefix: 'untypo/',
      region: 'us-east-1',
      secretAccessKey: 'secret',
    });
    await provider.upload('latest.untypo', Buffer.from('abc'));
    expect(send).toHaveBeenCalledOnce();
  });
});
