import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DictionaryLearningService } from '../../src/main/dictionary/learning';
import { ConfigurationService } from '../../src/main/storage/configuration';
import { MemorySecretProtector } from '../../src/main/storage/secret-protector';
import {
  DICTIONARY_LIMITS,
  type DictionaryCandidate,
} from '../../src/shared/dictionary';

const candidate: DictionaryCandidate = {
  category: 'product',
  confidence: 0.96,
  term: 'UnTypo',
};

const mediumConfidenceCandidate: DictionaryCandidate = {
  ...candidate,
  confidence: 0.9,
};

const lowConfidenceTechnicalCandidate: DictionaryCandidate = {
  category: 'technical',
  confidence: 0.85,
  term: 'RAG pipeline',
};

let configPath: string;
let configuration: ConfigurationService;
let directory: string;
let now: number;
let service: DictionaryLearningService;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'untypo-learning-'));
  configPath = path.join(directory, 'config.json');
  configuration = new ConfigurationService(
    configPath,
    new MemorySecretProtector(),
  );
  now = Date.UTC(2026, 7, 27);
  service = new DictionaryLearningService(configuration, () => now);
});

afterEach(async () => {
  await rm(directory, { force: true, recursive: true });
});

describe('DictionaryLearningService', () => {
  it('suggests a highly confident proper term on its first observation', async () => {
    await expect(service.observe([candidate, candidate])).resolves.toEqual(
      candidate,
    );
    expect(await readFile(configPath, 'utf8')).not.toContain(candidate.term);
    await expect(
      configuration.getDictionaryLearningState(),
    ).resolves.toMatchObject({
      candidates: [{ occurrences: 1 }],
    });
  });

  it('ranks candidates by adaptive reminder priority', async () => {
    const technicalCandidate: DictionaryCandidate = {
      category: 'technical',
      confidence: 0.99,
      term: 'TypeScript',
    };

    await expect(
      service.observe([technicalCandidate, candidate]),
    ).resolves.toEqual(candidate);
  });

  it('waits for a normal-confidence term to recur', async () => {
    await expect(
      service.observe([mediumConfidenceCandidate]),
    ).resolves.toBeUndefined();
    now += 1_000;
    await expect(service.observe([mediumConfidenceCandidate])).resolves.toEqual(
      mediumConfidenceCandidate,
    );
  });

  it('silently observes a low-confidence technical term until it is stable', async () => {
    for (let observation = 1; observation < 6; observation += 1) {
      await expect(
        service.observe([lowConfidenceTechnicalCandidate]),
      ).resolves.toBeUndefined();
      now += 1_000;
    }

    await expect(
      service.observe([lowConfidenceTechnicalCandidate]),
    ).resolves.toEqual(lowConfidenceTechnicalCandidate);
  });

  it('accepts an edited candidate as a learned dictionary entry', async () => {
    await expect(service.observe([candidate])).resolves.toEqual(candidate);
    await service.accept(candidate.term, 'UnTypo Desktop');

    await expect(configuration.load()).resolves.toMatchObject({
      dictionary: [{ source: 'learned', term: 'UnTypo Desktop' }],
    });
    await expect(configuration.getDictionaryLearningState()).resolves.toEqual({
      candidates: [],
      rejections: [],
    });
  });

  it('suppresses rejected terms for 30 days and then starts counting again', async () => {
    await service.observe([mediumConfidenceCandidate]);
    now += 1_000;
    await service.observe([mediumConfidenceCandidate]);
    await service.reject(mediumConfidenceCandidate.term);

    now += 29 * 24 * 60 * 60 * 1_000;
    await expect(
      service.observe([mediumConfidenceCandidate]),
    ).resolves.toBeUndefined();
    now += 2 * 24 * 60 * 60 * 1_000;
    await expect(
      service.observe([mediumConfidenceCandidate]),
    ).resolves.toBeUndefined();
    now += 1_000;
    await expect(service.observe([mediumConfidenceCandidate])).resolves.toEqual(
      mediumConfidenceCandidate,
    );
  });

  it('retains a refreshed rejection when the rejection limit is full', async () => {
    await configuration.updateDictionaryLearningState(() => ({
      candidates: [],
      rejections: Array.from(
        { length: DICTIONARY_LIMITS.candidates },
        (_, index) => ({
          fingerprint: `rejection-${String(index)}`,
          until: now + 60_000 + index,
        }),
      ),
    }));

    await service.reject(candidate.term);

    const state = await configuration.getDictionaryLearningState();
    expect(state.rejections).toHaveLength(DICTIONARY_LIMITS.candidates);
    expect(state.rejections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ until: now + 30 * 24 * 60 * 60 * 1_000 }),
      ]),
    );
  });

  it('normalizes equivalent Unicode forms across separate dictations', async () => {
    await expect(
      service.observe([{ ...mediumConfidenceCandidate, term: 'ＵｎＴｙｐｏ' }]),
    ).resolves.toBeUndefined();
    now += 1_000;
    await expect(service.observe([mediumConfidenceCandidate])).resolves.toEqual(
      mediumConfidenceCandidate,
    );
  });

  it('expires a one-off candidate after 30 days', async () => {
    await service.observe([mediumConfidenceCandidate]);
    now += 31 * 24 * 60 * 60 * 1_000;

    await expect(
      service.observe([mediumConfidenceCandidate]),
    ).resolves.toBeUndefined();
    now += 1_000;
    await expect(service.observe([mediumConfidenceCandidate])).resolves.toEqual(
      mediumConfidenceCandidate,
    );
  });

  it('does not learn a term already present in the dictionary', async () => {
    await configuration.addDictionaryEntry(candidate.term);

    await service.observe([candidate]);
    now += 1_000;
    await expect(service.observe([candidate])).resolves.toBeUndefined();
    await expect(configuration.getDictionaryLearningState()).resolves.toEqual({
      candidates: [],
      rejections: [],
    });
  });

  it('clears encrypted pending state when automatic learning is disabled', async () => {
    await service.observe([candidate]);
    expect(
      (await configuration.load()).dictionaryLearning.encryptedState,
    ).toBeDefined();

    await configuration.setDictionaryLearningEnabled(false);

    await expect(configuration.getDictionaryLearningState()).resolves.toEqual({
      candidates: [],
      rejections: [],
    });
    expect((await configuration.load()).dictionaryLearning).toEqual({
      enabled: false,
    });
  });
});
