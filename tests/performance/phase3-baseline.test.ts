import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DiagnosticCollector } from '../../src/main/diagnostics/collector';
import { ConfigurationService } from '../../src/main/storage/configuration';
import { HistoryRepository } from '../../src/main/storage/history';
import { MemorySecretProtector } from '../../src/main/storage/secret-protector';
import {
  packSyncFile,
  unpackSyncFile,
  UNTYPO_FILE_VERSION,
} from '../../src/main/sync/packer';

const warmupCount = 2;
const sampleCount = 8;

const percentile = (samples: readonly number[], ratio: number): number => {
  const ordered = [...samples].sort((left, right) => left - right);
  const index = Math.min(
    ordered.length - 1,
    Math.max(0, Math.ceil(ordered.length * ratio) - 1),
  );
  return ordered[index] ?? 0;
};

const summarize = (label: string, samples: readonly number[]): void => {
  const ordered = [...samples].sort((left, right) => left - right);
  process.stdout.write(
    `${JSON.stringify({
      label,
      max: ordered.at(-1),
      mean: samples.reduce((sum, value) => sum + value, 0) / samples.length,
      min: ordered[0],
      p95: percentile(samples, 0.95),
      samples,
    })}\n`,
  );
};

const measure = async (
  label: string,
  operation: () => unknown,
): Promise<void> => {
  for (let index = 0; index < warmupCount; index += 1) await operation();
  const samples: number[] = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const startedAt = performance.now();
    await operation();
    samples.push(performance.now() - startedAt);
  }
  summarize(label, samples);
};

const payload = {
  deviceName: 'BENCH',
  dictionary: [{ source: 'manual' as const, term: 'UnTypo' }],
  exportedAt: 1_700_000_000_000,
  history: [],
  personalization: {
    applicationStyles: {
      'ai-tool': 'prompt',
      browser: 'auto',
      'chat-app': 'casual',
      general: 'auto',
      ide: 'concise',
      office: 'formal',
    },
    learningEnabled: false,
  },
  profile: { displayName: 'Bench' },
  version: UNTYPO_FILE_VERSION,
};

describe('phase 3 performance baseline', () => {
  let rootDirectory = '';

  beforeAll(async () => {
    rootDirectory = await mkdtemp(path.join(tmpdir(), 'untypo-phase3-bench-'));
  });

  afterAll(async () => {
    await rm(rootDirectory, { force: true, recursive: true });
  });

  it('records configuration cache, history, PBKDF2, and diagnostic write timings', async () => {
    const configuration = new ConfigurationService(
      path.join(rootDirectory, 'config.json'),
      new MemorySecretProtector(),
    );
    await configuration.load();
    await measure('configuration.load.warm', () => configuration.load());

    const history = new HistoryRepository(
      path.join(rootDirectory, 'history.sqlite3'),
    );
    try {
      const createdAt = Date.now();
      history.importMissing(
        Array.from({ length: 1_000 }, (_, index) => ({
          createdAt: createdAt - index,
          id: `bench-${String(index)}`,
          intent: 'transcription' as const,
          language: 'zh-CN' as const,
          outputText: `bench-${String(index)}`,
          providerId: 'mock',
        })),
      );
      await measure('history.list.100', () => history.list(100, 0));
      await measure('history.getUsageStats', () => history.getUsageStats());
    } finally {
      history.close();
    }

    const packed = await packSyncFile(payload, 'K7M2NX4P', {
      appVersion: '0.2.1',
      createdAt: payload.exportedAt,
    });
    await measure('packer.unpackSyncFile', () =>
      unpackSyncFile(packed, 'K7M2NX4P'),
    );
    await expect(unpackSyncFile(packed, 'K7M2NX4P')).resolves.toMatchObject({
      deviceName: 'BENCH',
      version: UNTYPO_FILE_VERSION,
    });

    const diagnostics = new DiagnosticCollector({
      appName: 'UnTypo',
      appVersion: '0.2.1',
      rootDirectory: path.join(rootDirectory, 'diagnostics'),
    });
    await measure('diagnostics.log.100.flush', async () => {
      for (let index = 0; index < 100; index += 1) {
        diagnostics.log({
          context: { index },
          message: 'Baseline diagnostic entry',
          scope: 'bench.diagnostics',
        });
      }
      await diagnostics.flush();
    });
  });
});
