import { beforeEach, describe, expect, it, vi } from 'vitest';

const client = {
  createDirectory: vi.fn(),
  deleteFile: vi.fn(),
  exists: vi.fn(),
  getDirectoryContents: vi.fn(),
  getFileContents: vi.fn(),
  putFileContents: vi.fn(),
};

vi.mock('webdav', () => ({
  createClient: () => client,
}));

import { WebDavStorageProvider } from '../../../src/main/sync/providers/webdav-provider';

describe('WebDavStorageProvider', () => {
  beforeEach(() => {
    for (const method of Object.values(client)) method.mockReset();
  });

  it('creates the remote directory when the connection test finds none', async () => {
    client.exists.mockResolvedValueOnce(false);
    client.createDirectory.mockResolvedValueOnce(undefined);
    const provider = new WebDavStorageProvider({
      basePath: '/untypo/',
      password: 'secret',
      url: 'https://dav.example.test',
      username: 'hikaru',
    });
    await provider.testConnection();
    expect(client.createDirectory).toHaveBeenCalledWith('/untypo/', {
      recursive: true,
    });
  });

  it('filters directory listings to .untypo files', async () => {
    client.exists.mockResolvedValueOnce(true);
    client.getDirectoryContents.mockResolvedValueOnce([
      {
        basename: 'keep.untypo',
        filename: '/untypo/keep.untypo',
        lastmod: '2024-01-01T00:00:00.000Z',
        size: 8,
        type: 'file',
      },
      {
        basename: 'notes.txt',
        filename: '/untypo/notes.txt',
        lastmod: '2024-01-02T00:00:00.000Z',
        size: 3,
        type: 'file',
      },
    ]);
    const provider = new WebDavStorageProvider({
      basePath: '/untypo/',
      password: 'secret',
      url: 'https://dav.example.test',
      username: 'hikaru',
    });
    await expect(provider.list('')).resolves.toEqual([
      {
        lastModified: Date.parse('2024-01-01T00:00:00.000Z'),
        name: 'keep.untypo',
        path: 'untypo/keep.untypo',
        size: 8,
      },
    ]);
  });
});
