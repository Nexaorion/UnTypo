import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  HistoryRepository,
  HistoryService,
} from '../../src/main/storage/history';

let temporaryDirectory: string;
let repository: HistoryRepository;

beforeEach(async () => {
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'untypo-history-'));
  repository = new HistoryRepository(
    path.join(temporaryDirectory, 'history.sqlite3'),
  );
});

afterEach(async () => {
  repository.close();
  await rm(temporaryDirectory, { force: true, recursive: true });
});

describe('HistoryRepository', () => {
  it('stores text metadata without any audio field', () => {
    repository.add({
      createdAt: 100,
      id: 'first',
      intent: 'translation',
      language: 'zh-CN',
      outputText: 'Hello',
      providerId: 'mock',
      rawTranscript: '你好',
      scene: 'editor',
    });

    expect(repository.list()).toEqual([
      {
        createdAt: 100,
        id: 'first',
        intent: 'translation',
        language: 'zh-CN',
        outputText: 'Hello',
        providerId: 'mock',
        rawTranscript: '你好',
        scene: 'editor',
      },
    ]);
  });

  it('cleans expired records after recording a new result', () => {
    const service = new HistoryService(repository);
    const day = 24 * 60 * 60 * 1000;
    repository.add({
      createdAt: day,
      id: 'expired',
      intent: 'transcription',
      language: 'en-US',
      outputText: 'Old',
      providerId: 'mock',
    });

    service.record(
      {
        id: 'current',
        intent: 'instruction',
        language: 'en-US',
        outputText: 'New',
        providerId: 'mock',
      },
      { enabled: true, retentionDays: 7 },
      10 * day,
    );

    expect(repository.list().map((record) => record.id)).toEqual(['current']);
  });

  it('does not persist when history is disabled', () => {
    const result = new HistoryService(repository).record(
      {
        intent: 'transcription',
        language: 'en-US',
        outputText: 'Private',
        providerId: 'mock',
      },
      { enabled: false, retentionDays: 30 },
    );

    expect(result).toBeUndefined();
    expect(repository.list()).toEqual([]);
  });

  it('clears all records on request', () => {
    repository.add({
      intent: 'transcription',
      language: 'en-US',
      outputText: 'Delete me',
      providerId: 'mock',
    });

    expect(repository.clear()).toBe(1);
    expect(repository.list()).toEqual([]);
  });
});
