import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  DictationIntent,
  SupportedLanguage,
} from '../../core/providers/contracts.js';
import type { HistoryPolicy } from './configuration.js';

export interface HistoryRecord {
  createdAt: number;
  id: string;
  intent: DictationIntent;
  language: SupportedLanguage;
  outputText: string;
  providerId: string;
  rawTranscript?: string;
  scene?: string;
}

export type NewHistoryRecord = Omit<HistoryRecord, 'createdAt' | 'id'> & {
  createdAt?: number;
  id?: string;
};

interface HistoryRow {
  created_at: number;
  id: string;
  intent: DictationIntent;
  language: SupportedLanguage;
  output_text: string;
  provider_id: string;
  raw_transcript: string | null;
  scene: string | null;
}

const mapRow = (row: HistoryRow): HistoryRecord => ({
  createdAt: row.created_at,
  id: row.id,
  intent: row.intent,
  language: row.language,
  outputText: row.output_text,
  providerId: row.provider_id,
  ...(row.raw_transcript === null ? {} : { rawTranscript: row.raw_transcript }),
  ...(row.scene === null ? {} : { scene: row.scene }),
});

export class HistoryRepository {
  readonly #database: Database.Database;

  constructor(databasePath: string) {
    mkdirSync(path.dirname(databasePath), { recursive: true });
    this.#database = new Database(databasePath);
    this.#database.pragma('journal_mode = WAL');
    this.#database.pragma('foreign_keys = ON');
    this.migrate();
  }

  add(input: NewHistoryRecord): HistoryRecord {
    const record: HistoryRecord = {
      ...input,
      createdAt: input.createdAt ?? Date.now(),
      id: input.id ?? randomUUID(),
    };
    this.#database
      .prepare(
        `INSERT INTO dictation_history
          (id, created_at, provider_id, intent, output_text, raw_transcript, language, scene)
         VALUES
          (@id, @createdAt, @providerId, @intent, @outputText, @rawTranscript, @language, @scene)`,
      )
      .run({
        ...record,
        rawTranscript: record.rawTranscript ?? null,
        scene: record.scene ?? null,
      });
    return record;
  }

  list(limit = 100, offset = 0): readonly HistoryRecord[] {
    const safeLimit = Math.max(1, Math.min(500, Math.trunc(limit)));
    const safeOffset = Math.max(0, Math.trunc(offset));
    const rows = this.#database
      .prepare(
        `SELECT id, created_at, provider_id, intent, output_text,
                raw_transcript, language, scene
         FROM dictation_history
         ORDER BY created_at DESC, id DESC
         LIMIT ? OFFSET ?`,
      )
      .all(safeLimit, safeOffset) as HistoryRow[];
    return rows.map(mapRow);
  }

  deleteOlderThan(cutoff: number): number {
    return this.#database
      .prepare('DELETE FROM dictation_history WHERE created_at < ?')
      .run(cutoff).changes;
  }

  clear(): number {
    return this.#database.prepare('DELETE FROM dictation_history').run()
      .changes;
  }

  close(): void {
    this.#database.close();
  }

  private migrate(): void {
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS dictation_history (
        id TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        provider_id TEXT NOT NULL,
        intent TEXT NOT NULL CHECK (intent IN ('transcription', 'translation', 'instruction')),
        output_text TEXT NOT NULL,
        raw_transcript TEXT,
        language TEXT NOT NULL CHECK (language IN ('zh-CN', 'en-US')),
        scene TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_dictation_history_created_at
        ON dictation_history(created_at DESC);
      PRAGMA user_version = 1;
    `);
  }
}

export class HistoryService {
  readonly #repository: HistoryRepository;

  constructor(repository: HistoryRepository) {
    this.#repository = repository;
  }

  record(
    input: NewHistoryRecord,
    policy: HistoryPolicy,
    now = Date.now(),
  ): HistoryRecord | undefined {
    if (!policy.enabled) return undefined;
    const record = this.#repository.add({ ...input, createdAt: now });
    this.enforceRetention(policy, now);
    return record;
  }

  enforceRetention(policy: HistoryPolicy, now = Date.now()): number {
    if (policy.retentionDays === 0) return 0;
    const cutoff = now - policy.retentionDays * 24 * 60 * 60 * 1000;
    return this.#repository.deleteOlderThan(cutoff);
  }
}
