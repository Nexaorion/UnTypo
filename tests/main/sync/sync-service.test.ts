import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigurationService } from '../../../src/main/storage/configuration';
import { HistoryRepository } from '../../../src/main/storage/history';
import { MemorySecretProtector } from '../../../src/main/storage/secret-protector';
import { SyncService } from '../../../src/main/sync/sync-service';

let temporaryDirectory: string;
let history: HistoryRepository;
let sync: SyncService;

beforeEach(async () => {
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'untypo-sync-'));
  const configuration = new ConfigurationService(
    path.join(temporaryDirectory, 'config.json'),
    new MemorySecretProtector(),
  );
  history = new HistoryRepository(
    path.join(temporaryDirectory, 'history.sqlite3'),
  );
  sync = new SyncService({
    appVersion: '0.1.10',
    configuration,
    history,
  });
});

afterEach(async () => {
  history.close();
  await rm(temporaryDirectory, { force: true, recursive: true });
});

describe('SyncService backup code modes', () => {
  it('distinguishes custom passwords from generated default keys', async () => {
    await sync.updateConfig({ backupCode: 'K7M2NX4P' });
    await expect(sync.snapshot()).resolves.toMatchObject({
      backupCodeConfigured: true,
      customBackupCode: true,
    });

    const generated = await sync.generateBackupCode();

    expect(generated).toHaveLength(8);
    await expect(sync.snapshot()).resolves.toMatchObject({
      backupCodeConfigured: true,
      customBackupCode: false,
    });
  });
});
