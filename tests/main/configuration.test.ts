import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigurationService } from '../../src/main/storage/configuration';
import { MemorySecretProtector } from '../../src/main/storage/secret-protector';

let temporaryDirectory: string;
let service: ConfigurationService;
let configPath: string;
let protector: MemorySecretProtector;

beforeEach(async () => {
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'untypo-config-'));
  configPath = path.join(temporaryDirectory, 'config.json');
  protector = new MemorySecretProtector();
  service = new ConfigurationService(configPath, protector);
});

afterEach(async () => {
  await rm(temporaryDirectory, { force: true, recursive: true });
});

describe('ConfigurationService', () => {
  it('returns the bilingual Windows defaults before the first write', async () => {
    await expect(service.load()).resolves.toMatchObject({
      version: 3,
      diagnostics: {
        automaticCollection: true,
        showErrorDialogs: false,
      },
      dictionaryLearning: { enabled: true },
      general: { locale: 'zh-CN' },
      dictation: {
        defaultTargetLanguage: 'en-US',
        hotkeyAccelerator: 'Ctrl+Alt+Space',
        language: 'zh-CN',
      },
      history: { enabled: true, retentionDays: 30 },
      updates: { autoCheck: true, autoDownload: true },
    });
  });

  it('adds diagnostic and update defaults to an existing v2 configuration', async () => {
    await writeFile(
      configPath,
      JSON.stringify({
        version: 2,
        general: { launchAtLogin: false, locale: 'zh-CN' },
        dictation: {
          defaultTargetLanguage: 'en-US',
          hotkeyAccelerator: 'Ctrl+Alt+Space',
          language: 'zh-CN',
        },
        dictionary: ['UnTypo'],
        history: { enabled: true, retentionDays: 30 },
        providers: [],
      }),
      'utf8',
    );

    await expect(service.load()).resolves.toMatchObject({
      dictionary: [{ source: 'manual', term: 'UnTypo' }],
      dictionaryLearning: { enabled: true },
      diagnostics: {
        automaticCollection: true,
        showErrorDialogs: false,
      },
      version: 3,
      updates: { autoCheck: true, autoDownload: true },
    });
    await expect(readFile(configPath, 'utf8')).resolves.toContain(
      '"autoDownload": true',
    );
    await expect(readFile(configPath, 'utf8')).resolves.toContain(
      '"showErrorDialogs": false',
    );
    await expect(readFile(configPath, 'utf8')).resolves.toContain(
      '"version": 3',
    );
  });

  it('rejects migrated terms that exceed the limit after normalization', async () => {
    await writeFile(
      configPath,
      JSON.stringify({
        version: 2,
        general: { launchAtLogin: false, locale: 'zh-CN' },
        dictation: {
          defaultTargetLanguage: 'en-US',
          hotkeyAccelerator: 'Ctrl+Alt+Space',
          language: 'zh-CN',
        },
        dictionary: ['ﬃ'.repeat(50)],
        history: { enabled: true, retentionDays: 30 },
        providers: [],
      }),
      'utf8',
    );

    await expect(service.load()).rejects.toThrow('Invalid dictionary');
  });

  it('migrates the legacy 1Password-conflicting default hotkey', async () => {
    await writeFile(
      configPath,
      JSON.stringify({
        version: 2,
        general: { launchAtLogin: false, locale: 'zh-CN' },
        dictation: {
          defaultTargetLanguage: 'en-US',
          hotkeyAccelerator: 'Ctrl+Shift+Space',
          hotkeyMode: 'push-to-talk',
          language: 'zh-CN',
        },
        dictionary: [],
        history: { enabled: true, retentionDays: 30 },
        providers: [],
      }),
      'utf8',
    );

    await expect(service.load()).resolves.toMatchObject({
      dictation: { hotkeyAccelerator: 'Ctrl+Alt+Space' },
    });
    await expect(readFile(configPath, 'utf8')).resolves.toContain(
      '"hotkeyAccelerator": "Ctrl+Alt+Space"',
    );
    await expect(readFile(configPath, 'utf8')).resolves.not.toContain(
      '"hotkeyMode"',
    );
  });

  it('preserves a user-selected hotkey while migrating defaults', async () => {
    await writeFile(
      configPath,
      JSON.stringify({
        version: 2,
        general: { launchAtLogin: false, locale: 'zh-CN' },
        dictation: {
          defaultTargetLanguage: 'en-US',
          hotkeyAccelerator: 'Ctrl+Alt+K',
          hotkeyMode: 'toggle',
          language: 'zh-CN',
        },
        dictionary: [],
        history: { enabled: true, retentionDays: 30 },
        providers: [],
      }),
      'utf8',
    );

    await expect(service.load()).resolves.toMatchObject({
      dictation: {
        hotkeyAccelerator: 'Ctrl+Alt+K',
      },
    });
    await expect(readFile(configPath, 'utf8')).resolves.not.toContain(
      '"hotkeyMode"',
    );
  });

  it('normalizes the global dictionary', async () => {
    await service.addDictionaryEntry(' UnTypo ');
    const config = await service.addDictionaryEntry('Nexaorion');

    expect(config.dictionary).toEqual([
      { source: 'manual', term: 'UnTypo' },
      { source: 'manual', term: 'Nexaorion' },
    ]);
    await expect(service.load()).resolves.toMatchObject({
      dictionary: [
        { source: 'manual', term: 'UnTypo' },
        { source: 'manual', term: 'Nexaorion' },
      ],
    });
  });

  it('persists an explicit microphone without changing automatic defaults', async () => {
    expect((await service.load()).dictation).not.toHaveProperty(
      'microphoneDeviceId',
    );

    await service.update((config) => ({
      ...config,
      dictation: { ...config.dictation, microphoneDeviceId: 'microphone-1' },
    }));

    await expect(service.load()).resolves.toMatchObject({
      dictation: { microphoneDeviceId: 'microphone-1' },
    });
  });

  it('never writes provider secrets or profile fields as plaintext', async () => {
    await service.setProfile({
      displayName: 'Alice Example',
      signature: 'Warm regards, Alice',
    });
    await service.upsertProvider({
      id: 'primary-openai',
      kind: 'text',
      providerId: 'openai-compatible-text',
      secrets: { apiKey: 'sk-plaintext-secret' },
      values: {
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
        name: 'OpenAI',
        presetId: 'openai-text',
      },
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
      kind: 'text',
      providerId: 'openai-compatible-text',
      secrets: { apiKey: 'sk-plaintext-secret' },
      values: { model: 'gpt-4o-mini' },
    });
  });

  it('preserves the encrypted API key when an existing profile omits it', async () => {
    await service.upsertProvider({
      id: 'primary-text',
      kind: 'text',
      providerId: 'anthropic-text',
      secrets: { apiKey: 'anthropic-secret' },
      values: {
        baseUrl: 'https://api.anthropic.com/v1',
        model: 'claude-sonnet-4-5',
        name: 'Anthropic',
        presetId: 'anthropic-text',
      },
    });
    const before = JSON.parse(await readFile(configPath, 'utf8')) as {
      providers: Array<{ secrets: { apiKey: unknown } }>;
    };

    await service.upsertProvider({
      id: 'primary-text',
      kind: 'text',
      providerId: 'anthropic-text',
      secrets: {},
      values: {
        baseUrl: 'https://api.anthropic.com/v1',
        model: 'claude-opus-4-1',
        name: 'Anthropic edited',
        presetId: 'anthropic-text',
      },
    });
    const after = JSON.parse(await readFile(configPath, 'utf8')) as {
      providers: Array<{ secrets: { apiKey: unknown } }>;
    };

    expect(after.providers[0]?.secrets.apiKey).toEqual(
      before.providers[0]?.secrets.apiKey,
    );
    await expect(service.getProvider('primary-text')).resolves.toMatchObject({
      secrets: { apiKey: 'anthropic-secret' },
      values: { model: 'claude-opus-4-1' },
    });
  });

  it('requires an API key when creating a provider profile', async () => {
    await expect(
      service.upsertProvider({
        id: 'new-speech',
        kind: 'speech',
        providerId: 'aliyun-bailian-speech',
        secrets: {},
        values: {
          baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
          model: 'qwen-audio-3.0-asr-flash',
          name: 'Aliyun Bailian',
          presetId: 'aliyun-bailian-speech',
        },
      }),
    ).rejects.toThrow('requires an API key');
  });

  it('atomically clears only the matching active role when removed', async () => {
    await service.upsertProvider({
      id: 'active-speech',
      kind: 'speech',
      providerId: 'openai-compatible-speech',
      secrets: { apiKey: 'speech-key' },
      values: {
        baseUrl: 'https://api.openai.com/v1',
        model: 'whisper-1',
        name: 'Speech',
        presetId: 'openai-speech',
      },
    });
    await service.upsertProvider({
      id: 'active-text',
      kind: 'text',
      providerId: 'openai-compatible-text',
      secrets: { apiKey: 'text-key' },
      values: {
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
        name: 'Text',
        presetId: 'openai-text',
      },
    });
    await service.update((config) => ({
      ...config,
      dictation: {
        ...config.dictation,
        activeSpeechProviderProfileId: 'active-speech',
        activeTextProviderProfileId: 'active-text',
      },
    }));

    const next = await service.removeProvider('active-speech');
    expect(next.dictation.activeSpeechProviderProfileId).toBeUndefined();
    expect(next.dictation.activeTextProviderProfileId).toBe('active-text');
    expect(next.providers.map(({ id }) => id)).toEqual(['active-text']);
    await expect(service.load()).resolves.toMatchObject({
      dictation: { activeTextProviderProfileId: 'active-text' },
    });
  });

  it('rejects editing an existing profile across provider roles', async () => {
    await service.upsertProvider({
      id: 'fixed-role',
      kind: 'text',
      providerId: 'anthropic-text',
      secrets: { apiKey: 'text-key' },
      values: {
        baseUrl: 'https://api.anthropic.com/v1',
        model: 'claude-sonnet-4-5',
        name: 'Anthropic',
        presetId: 'anthropic-text',
      },
    });

    await expect(
      service.upsertProvider({
        id: 'fixed-role',
        kind: 'speech',
        providerId: 'openai-compatible-speech',
        secrets: {},
        values: {
          baseUrl: 'https://api.openai.com/v1',
          model: 'whisper-1',
          name: 'Speech',
          presetId: 'openai-speech',
        },
      }),
    ).rejects.toThrow('cannot change kind');
  });

  it('rejects a v2 active profile that belongs to the other role', async () => {
    await writeFile(
      configPath,
      JSON.stringify({
        version: 2,
        general: { launchAtLogin: false, locale: 'en-US' },
        dictation: {
          activeSpeechProviderProfileId: 'text-only',
          defaultTargetLanguage: 'zh-CN',
          hotkeyAccelerator: 'Ctrl+Shift+Space',
          hotkeyMode: 'toggle',
          language: 'en-US',
        },
        dictionary: [],
        history: { enabled: true, retentionDays: 30 },
        providers: [
          {
            id: 'text-only',
            kind: 'text',
            providerId: 'openai-compatible-text',
            secrets: { apiKey: protector.protect('text-key') },
            values: {
              baseUrl: 'https://api.openai.com/v1',
              model: 'gpt-4o-mini',
              name: 'Text',
              presetId: 'openai-text',
            },
          },
        ],
      }),
      'utf8',
    );

    await expect(service.load()).rejects.toThrow(
      'Active speech provider profile is invalid',
    );
  });

  it('migrates a combined v1 OpenAI profile into text and speech profiles', async () => {
    const encryptedApiKey = protector.protect('sk-legacy-secret');
    const longId = 'a'.repeat(64);
    await writeFile(
      configPath,
      JSON.stringify({
        version: 1,
        general: { launchAtLogin: false, locale: 'zh-CN' },
        dictation: {
          activeProviderProfileId: longId,
          defaultTargetLanguage: 'en-US',
          hotkeyAccelerator: 'Ctrl+Shift+Space',
          hotkeyMode: 'push-to-talk',
          language: 'zh-CN',
        },
        dictionary: ['UnTypo'],
        history: { enabled: true, retentionDays: 30 },
        providers: [
          {
            id: longId,
            providerId: 'openai',
            secrets: { apiKey: encryptedApiKey },
            values: {
              allowInsecurePrivateEndpoint: false,
              baseUrl: 'https://gateway.example.test/v1',
              textModel: 'legacy-text-model',
              transcriptionModel: 'legacy-speech-model',
            },
          },
        ],
      }),
      'utf8',
    );

    const migrated = await service.load();
    const speech = migrated.providers.find(({ kind }) => kind === 'speech');
    const text = migrated.providers.find(({ kind }) => kind === 'text');
    expect(migrated.version).toBe(3);
    expect(speech).toMatchObject({
      id: longId,
      providerId: 'openai-compatible-speech',
      secrets: { apiKey: encryptedApiKey },
      values: {
        model: 'legacy-speech-model',
        presetId: 'custom-openai-speech',
      },
    });
    expect(text).toMatchObject({
      providerId: 'openai-compatible-text',
      secrets: { apiKey: encryptedApiKey },
      values: {
        model: 'legacy-text-model',
        presetId: 'custom-text',
      },
    });
    expect(text?.id).toMatch(/^[a-z0-9][a-z0-9._-]{0,63}$/u);
    expect(text?.id).not.toBe(speech?.id);
    expect(migrated.dictation).toMatchObject({
      activeSpeechProviderProfileId: speech?.id,
      activeTextProviderProfileId: text?.id,
    });
    await expect(service.getProvider(speech?.id ?? '')).resolves.toMatchObject({
      secrets: { apiKey: 'sk-legacy-secret' },
    });
    await expect(service.getProvider(text?.id ?? '')).resolves.toMatchObject({
      secrets: { apiKey: 'sk-legacy-secret' },
    });

    const persisted = JSON.parse(await readFile(configPath, 'utf8')) as {
      version: number;
    };
    expect(persisted.version).toBe(3);
  });

  it('activates the first migrated pair when v1 had no explicit active profile', async () => {
    await writeFile(
      configPath,
      JSON.stringify({
        version: 1,
        general: { launchAtLogin: false, locale: 'en-US' },
        dictation: {
          defaultTargetLanguage: 'zh-CN',
          hotkeyAccelerator: 'Ctrl+Shift+Space',
          hotkeyMode: 'toggle',
          language: 'en-US',
        },
        dictionary: [],
        history: { enabled: true, retentionDays: 30 },
        providers: [
          {
            id: 'legacy-default',
            providerId: 'openai',
            secrets: { apiKey: protector.protect('legacy-key') },
            values: {
              textModel: 'legacy-text',
              transcriptionModel: 'legacy-speech',
            },
          },
        ],
      }),
      'utf8',
    );

    const migrated = await service.load();
    expect(migrated.dictation).toMatchObject({
      activeSpeechProviderProfileId: 'legacy-default',
      activeTextProviderProfileId: 'legacy-default-text',
    });
  });

  it('ignores legacy provider records that the v1 runtime could not activate', async () => {
    await writeFile(
      configPath,
      JSON.stringify({
        version: 1,
        general: { launchAtLogin: false, locale: 'en-US' },
        dictation: {
          defaultTargetLanguage: 'zh-CN',
          hotkeyAccelerator: 'Ctrl+Shift+Space',
          hotkeyMode: 'toggle',
          language: 'en-US',
        },
        dictionary: [],
        history: { enabled: true, retentionDays: 30 },
        providers: [
          {
            id: 'unknown-manual-provider',
            providerId: 'community-provider',
            secrets: {},
            values: {},
          },
          {
            id: 'legacy-valid',
            providerId: 'openai',
            secrets: { apiKey: protector.protect('legacy-key') },
            values: {
              textModel: 'legacy-text',
              transcriptionModel: 'legacy-speech',
            },
          },
        ],
      }),
      'utf8',
    );

    const migrated = await service.load();
    expect(migrated.providers).toHaveLength(2);
    expect(migrated.providers.map(({ id }) => id)).toEqual([
      'legacy-valid',
      'legacy-valid-text',
    ]);
    expect(migrated.dictation).toMatchObject({
      activeSpeechProviderProfileId: 'legacy-valid',
      activeTextProviderProfileId: 'legacy-valid-text',
    });
  });

  it('serializes concurrent updates without dropping data', async () => {
    await Promise.all([
      service.addDictionaryEntry('UnTypo'),
      service.upsertProvider({
        id: 'speech-profile',
        kind: 'speech',
        providerId: 'openai-compatible-speech',
        secrets: { apiKey: 'secret' },
        values: {
          baseUrl: 'https://api.openai.com/v1',
          model: 'whisper-1',
          name: 'OpenAI Speech',
          presetId: 'openai-speech',
        },
      }),
    ]);

    await expect(service.load()).resolves.toMatchObject({
      dictionary: [{ source: 'manual', term: 'UnTypo' }],
      providers: [
        {
          id: 'speech-profile',
          providerId: 'openai-compatible-speech',
        },
      ],
    });
  });
});
