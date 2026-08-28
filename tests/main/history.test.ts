import Database from 'better-sqlite3';
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

  it('round-trips local model-call timing and input/output details', () => {
    repository.add({
      createdAt: 101,
      id: 'trace',
      intent: 'transcription',
      language: 'zh-CN',
      outputText: '整理后的文本',
      processingTrace: {
        injectionMs: 12,
        modelCalls: [
          {
            durationMs: 1_234,
            firstOutputMs: 456,
            input: {
              defaultTargetLanguage: 'zh-CN',
              dictionaryLearningEnabled: true,
              dictionaryTermCount: 3,
              forcedIntent: 'transcription',
              locale: 'zh-CN',
              text: '原始文本',
            },
            kind: 'text-generation',
            modelName: 'glm-5.3-flash',
            outputText: '整理后的文本',
            providerId: 'text-profile',
            providerName: '智谱',
            providerType: 'openai-compatible-text',
            status: 'success',
          },
        ],
        modelProcessingMs: 1_500,
        operationId: 'operation-1',
        recorderFinalizationMs: 40,
        totalDurationMs: 1_552,
      },
      providerId: 'speech-profile',
      rawTranscript: '原始文本',
    });

    const saved = repository.list()[0]?.processingTrace;
    expect(saved).toMatchObject({
      injectionMs: 12,
      modelProcessingMs: 1_500,
      operationId: 'operation-1',
      recorderFinalizationMs: 40,
      totalDurationMs: 1_552,
    });
    expect(saved?.modelCalls).toHaveLength(1);
    const call = saved?.modelCalls[0];
    expect(call).toMatchObject({
      durationMs: 1_234,
      firstOutputMs: 456,
      modelName: 'glm-5.3-flash',
      outputText: '整理后的文本',
    });
    expect(call?.kind === 'text-generation' ? call.input.text : undefined).toBe(
      '原始文本',
    );
  });

  it('migrates existing history databases without losing old records', () => {
    const databasePath = path.join(temporaryDirectory, 'legacy.sqlite3');
    const legacy = new Database(databasePath);
    legacy.exec(`
      CREATE TABLE dictation_history (
        id TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        provider_id TEXT NOT NULL,
        intent TEXT NOT NULL,
        output_text TEXT NOT NULL,
        raw_transcript TEXT,
        language TEXT NOT NULL,
        scene TEXT,
        audio_duration_ms INTEGER,
        model_name TEXT
      );
      INSERT INTO dictation_history
        (id, created_at, provider_id, intent, output_text, language)
      VALUES ('legacy', 100, 'mock', 'transcription', 'Old text', 'en-US');
      PRAGMA user_version = 2;
    `);
    legacy.close();

    const migrated = new HistoryRepository(databasePath);
    try {
      expect(migrated.list()).toEqual([
        expect.objectContaining({ id: 'legacy', outputText: 'Old text' }),
      ]);
      migrated.add({
        id: 'new',
        intent: 'transcription',
        language: 'en-US',
        outputText: 'New text',
        processingTrace: {
          injectionMs: 1,
          modelCalls: [],
          modelProcessingMs: 2,
          operationId: 'operation-2',
          recorderFinalizationMs: 3,
          totalDurationMs: 6,
        },
        providerId: 'mock',
      });
      expect(migrated.list()[0]?.processingTrace?.operationId).toBe(
        'operation-2',
      );
    } finally {
      migrated.close();
    }
  });

  it('aggregates dashboard usage across all history records', () => {
    repository.add({
      audioDurationMs: 1_200,
      createdAt: 300,
      id: 'first',
      intent: 'transcription',
      language: 'zh-CN',
      modelName: 'whisper-1',
      outputText: '你好',
      providerId: 'openai',
    });
    repository.add({
      audioDurationMs: 800,
      createdAt: 200,
      id: 'second',
      intent: 'transcription',
      language: 'en-US',
      modelName: 'whisper-1',
      outputText: 'Hello',
      providerId: 'openai',
    });
    repository.add({
      createdAt: 100,
      id: 'third',
      intent: 'instruction',
      language: 'en-US',
      modelName: 'gpt-4o-mini-transcribe',
      outputText: 'A',
      providerId: 'openai',
    });

    expect(repository.getUsageStats()).toEqual({
      mostUsedModel: 'whisper-1',
      outputCharacters: 8,
      transcriptionDurationMs: 2_000,
      usageCount: 3,
    });
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
