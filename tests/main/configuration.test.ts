import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigurationService } from '../../src/main/storage/configuration';
import { MemorySecretProtector } from '../../src/main/storage/secret-protector';

let temporaryDirectory: string;
let service: ConfigurationService;
let configPath: string;

beforeEach(async () => {
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'untypo-config-'));
  configPath = path.join(temporaryDirectory, 'config.json');
  service = new ConfigurationService(configPath, new MemorySecretProtector());
});

afterEach(async () => {
  await rm(temporaryDirectory, { force: true, recursive: true });
});

describe('ConfigurationService', () => {
  it('returns the bilingual Windows defaults before the first write', async () => {
    await expect(service.load()).resolves.toMatchObject({
      version: 1,
      general: { locale: 'zh-CN' },
      dictation: {
        defaultTargetLanguage: 'en-US',
        hotkeyMode: 'push-to-talk',
        language: 'zh-CN',
      },
      history: { enabled: true, retentionDays: 30 },
    });
  });

  it('normalizes the global dictionary', async () => {
    const config = await service.setDictionary([
      ' UnTypo ',
      'Nexaorion',
      'UnTypo',
      '',
    ]);

    expect(config.dictionary).toEqual(['UnTypo', 'Nexaorion']);
    await expect(service.load()).resolves.toMatchObject({
      dictionary: ['UnTypo', 'Nexaorion'],
    });
  });

  it('never writes provider secrets or profile fields as plaintext', async () => {
    await service.setProfile({
      displayName: 'Alice Example',
      signature: 'Warm regards, Alice',
    });
    await service.upsertProvider({
      id: 'primary-openai',
      providerId: 'openai',
      secrets: { apiKey: 'sk-plaintext-secret' },
      values: { model: 'gpt-audio' },
    });

    const stored = await readFile(configPath, 'utf8');
    expect(stored).not.toContain('sk-plaintext-secret');
    expect(stored).not.toContain('Alice Example');
    expect(stored).not.toContain('Warm regards, Alice');
    await expect(service.getProfile()).resolves.toMatchObject({
      displayName: 'Alice Example',
      signature: 'Warm regards, Alice',
    });
    await expect(service.getProvider('primary-openai')).resolves.toMatchObject({
      providerId: 'openai',
      secrets: { apiKey: 'sk-plaintext-secret' },
      values: { model: 'gpt-audio' },
    });
  });

  it('serializes concurrent updates without dropping data', async () => {
    await Promise.all([
      service.setDictionary(['UnTypo']),
      service.upsertProvider({
        id: 'mock-profile',
        providerId: 'mock',
        secrets: {},
        values: {},
      }),
    ]);

    await expect(service.load()).resolves.toMatchObject({
      dictionary: ['UnTypo'],
      providers: [{ id: 'mock-profile', providerId: 'mock' }],
    });
  });
});
