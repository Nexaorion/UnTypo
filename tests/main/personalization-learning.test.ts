import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WritingPreferenceLearningService } from '../../src/main/personalization/learning';
import { ConfigurationService } from '../../src/main/storage/configuration';
import { MemorySecretProtector } from '../../src/main/storage/secret-protector';
import type { WritingPreferenceCandidate } from '../../src/shared/personalization';

const politeTone: WritingPreferenceCandidate = {
  confidence: 0.95,
  kind: 'tone',
  value: 'polite',
};

let configPath: string;
let configuration: ConfigurationService;
let directory: string;
let now: number;
let service: WritingPreferenceLearningService;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'untypo-personalization-'));
  configPath = path.join(directory, 'config.json');
  configuration = new ConfigurationService(
    configPath,
    new MemorySecretProtector(),
  );
  now = Date.UTC(2026, 7, 29);
  service = new WritingPreferenceLearningService(configuration, () => now);
  await configuration.setPersonalizationLearningEnabled(true);
});

afterEach(async () => {
  await rm(directory, { force: true, recursive: true });
});

describe('WritingPreferenceLearningService', () => {
  it('adapts to repeated evidence and encrypts confirmed preferences', async () => {
    await service.observe([politeTone], 'chat-app');
    await expect(service.snapshot()).resolves.toMatchObject({
      suggestions: [],
    });

    now += 1_000;
    await service.observe([politeTone], 'chat-app');
    const suggestion = (await service.snapshot()).suggestions[0];
    expect(suggestion).toMatchObject({
      application: 'chat-app',
      kind: 'tone',
      occurrences: 2,
      value: 'polite',
    });
    if (!suggestion)
      throw new Error('Expected a writing preference suggestion');

    await service.accept(suggestion.id);

    await expect(service.snapshot()).resolves.toMatchObject({
      preferences: [{ application: 'chat-app', kind: 'tone', value: 'polite' }],
      suggestions: [],
    });
    expect(await readFile(configPath, 'utf8')).not.toContain('polite');
  });

  it('applies rejection cooldown before observing the same habit again', async () => {
    await service.observe([politeTone], 'office');
    now += 1_000;
    await service.observe([politeTone], 'office');
    const suggestion = (await service.snapshot()).suggestions[0];
    if (!suggestion)
      throw new Error('Expected a writing preference suggestion');
    await service.reject(suggestion.id);

    now += 29 * 24 * 60 * 60 * 1_000;
    await service.observe([politeTone], 'office');
    await expect(service.snapshot()).resolves.toMatchObject({
      suggestions: [],
    });

    now += 2 * 24 * 60 * 60 * 1_000;
    await service.observe([politeTone], 'office');
    now += 1_000;
    await service.observe([politeTone], 'office');
    await expect(service.snapshot()).resolves.toMatchObject({
      suggestions: [{ application: 'office', occurrences: 2 }],
    });
  });

  it('stops pending learning without deleting confirmed memory', async () => {
    await service.observe([politeTone], 'chat-app');
    now += 1_000;
    await service.observe([politeTone], 'chat-app');
    const suggestion = (await service.snapshot()).suggestions[0];
    if (!suggestion)
      throw new Error('Expected a writing preference suggestion');
    await service.accept(suggestion.id);
    await service.observe(
      [{ confidence: 0.9, kind: 'expression', value: '诶' }],
      'chat-app',
    );

    await configuration.setPersonalizationLearningEnabled(false);

    await expect(service.snapshot()).resolves.toMatchObject({
      preferences: [{ value: 'polite' }],
      suggestions: [],
    });
    await expect(
      configuration.getPersonalizationState(),
    ).resolves.toMatchObject({ candidates: [], rejections: [] });

    await service.clear();
    await expect(service.snapshot()).resolves.toEqual({
      preferences: [],
      suggestions: [],
    });
  });
});
