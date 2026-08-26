import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { arch, platform, release } from 'node:os';
import path from 'node:path';
import type { AudioPayload } from '../../core/providers/contracts.js';
import type {
  ClientDiagnosticExportRequest,
  ClientDiagnosticIssue,
  ClientDiagnosticIssueKind,
  ClientDiagnosticLevel,
  ClientDiagnosticLogEntry,
  ClientDiagnosticSnapshot,
  ClientRendererIssueInput,
} from '../../shared/diagnostics.js';
import { createDiagnosticZip, type DiagnosticArchiveEntry } from './archive.js';
import {
  redactDiagnosticText,
  sanitizeDiagnosticContext,
  sanitizeDiagnosticEndpoint,
} from './redaction.js';

interface StoredDiagnosticIssue extends ClientDiagnosticIssue {
  audioFileName?: string;
}

interface DiagnosticCollectorOptions {
  appName: string;
  appVersion: string;
  now?: () => number;
  retentionDays?: number;
  rootDirectory: string;
}

export interface DiagnosticIssueInput {
  audio?: AudioPayload;
  context?: Readonly<Record<string, unknown>>;
  error: unknown;
  kind: ClientDiagnosticIssueKind;
  operationId?: string;
  source: string;
}

export interface DiagnosticLogInput {
  context?: Readonly<Record<string, unknown>>;
  level?: ClientDiagnosticLevel;
  message: string;
  operationId?: string;
  scope: string;
}

interface ProviderRequestContext {
  model: string;
  profileId: string;
  providerId: string;
}

const maxLogBytes = 5 * 1024 * 1024;
const maxRecentEntries = 200;
const maxTimelineEntries = 40;
const issuesFileVersion = 1;

const audioExtension = (mimeType: string): string => {
  const normalized = mimeType.toLowerCase();
  if (normalized.includes('wav')) return 'wav';
  if (normalized.includes('ogg')) return 'ogg';
  if (normalized.includes('mp4') || normalized.includes('m4a')) return 'm4a';
  return 'webm';
};

const normalizeError = (error: unknown): ClientDiagnosticIssue['error'] => {
  if (error instanceof Error) {
    return {
      message: redactDiagnosticText(error.message || error.name),
      name: redactDiagnosticText(error.name || 'Error'),
      ...(error.stack ? { stack: redactDiagnosticText(error.stack) } : {}),
    };
  }
  return {
    message: redactDiagnosticText(
      typeof error === 'string' ? error : 'Unknown application error',
    ),
    name: 'Error',
  };
};

const requestBodySize = (
  body: BodyInit | null | undefined,
): number | undefined => {
  if (typeof body === 'string') return Buffer.byteLength(body, 'utf8');
  if (body instanceof URLSearchParams) {
    return Buffer.byteLength(body.toString(), 'utf8');
  }
  if (body instanceof ArrayBuffer) return body.byteLength;
  if (ArrayBuffer.isView(body)) return body.byteLength;
  return undefined;
};

const headerValue = (
  headers: HeadersInit | undefined,
  name: string,
): string | undefined => {
  if (!headers) return undefined;
  return new Headers(headers).get(name) ?? undefined;
};

const parseStoredIssues = (value: unknown): StoredDiagnosticIssue[] => {
  if (typeof value !== 'object' || value === null) return [];
  const record = value as Record<string, unknown>;
  if (record.version !== issuesFileVersion || !Array.isArray(record.issues)) {
    return [];
  }
  return record.issues.filter(
    (issue): issue is StoredDiagnosticIssue =>
      typeof issue === 'object' &&
      issue !== null &&
      typeof (issue as Record<string, unknown>).id === 'string' &&
      typeof (issue as Record<string, unknown>).occurredAt === 'number',
  );
};

const toClientIssue = (
  issue: StoredDiagnosticIssue,
): ClientDiagnosticIssue => ({
  ...(issue.acknowledgedAt !== undefined
    ? { acknowledgedAt: issue.acknowledgedAt }
    : {}),
  audioAvailable: issue.audioAvailable,
  ...(issue.context ? { context: issue.context } : {}),
  error: issue.error,
  id: issue.id,
  kind: issue.kind,
  occurredAt: issue.occurredAt,
  ...(issue.operationId ? { operationId: issue.operationId } : {}),
  source: issue.source,
  timeline: issue.timeline,
});

export class DiagnosticCollector {
  readonly #appName: string;
  readonly #appVersion: string;
  readonly #attachmentsDirectory: string;
  readonly #changedListeners = new Set<() => void>();
  readonly #issuesPath: string;
  readonly #logsDirectory: string;
  readonly #now: () => number;
  readonly #operation = new AsyncLocalStorage<{ operationId: string }>();
  readonly #retentionDays: number;
  readonly #rootDirectory: string;
  readonly #sessionId = randomUUID();
  #issues: StoredDiagnosticIssue[] = [];
  #recentEntries: ClientDiagnosticLogEntry[] = [];

  constructor(options: DiagnosticCollectorOptions) {
    this.#appName = options.appName;
    this.#appVersion = options.appVersion;
    this.#now = options.now ?? Date.now;
    this.#retentionDays = options.retentionDays ?? 14;
    this.#rootDirectory = options.rootDirectory;
    this.#logsDirectory = path.join(this.#rootDirectory, 'logs');
    this.#attachmentsDirectory = path.join(this.#rootDirectory, 'attachments');
    this.#issuesPath = path.join(this.#rootDirectory, 'issues.json');
    mkdirSync(this.#logsDirectory, { recursive: true });
    mkdirSync(this.#attachmentsDirectory, { recursive: true });
    this.loadIssues();
    this.cleanupExpiredData();
    this.log({
      context: {
        appVersion: this.#appVersion,
        architecture: arch(),
        packaged: process.env.NODE_ENV === 'production',
        platform: platform(),
      },
      message: 'Application diagnostic session started',
      scope: 'app.lifecycle',
    });
  }

  acknowledge(issueIds: readonly string[]): ClientDiagnosticSnapshot {
    const ids = new Set(issueIds);
    const acknowledgedAt = this.#now();
    let changed = false;
    this.#issues = this.#issues.map((issue) => {
      if (!ids.has(issue.id) || issue.acknowledgedAt !== undefined)
        return issue;
      changed = true;
      if (issue.audioFileName) this.removeAttachment(issue.audioFileName);
      return {
        ...toClientIssue(issue),
        acknowledgedAt,
        audioAvailable: false,
      };
    });
    if (changed) {
      this.persistIssues();
      this.log({
        context: { issueCount: ids.size },
        message: 'Diagnostic issues acknowledged',
        scope: 'diagnostics.lifecycle',
      });
      this.emitChanged();
    }
    return this.snapshot();
  }

  buildArchive(request: ClientDiagnosticExportRequest): Buffer {
    const selectedIds = new Set(request.issueIds);
    const selected = this.#issues.filter((issue) => selectedIds.has(issue.id));
    const exportedAt = new Date(this.#now());
    const audioFiles: DiagnosticArchiveEntry[] = [];
    const clientIssues = selected.map((issue) => {
      if (request.includeAudio && issue.audioFileName) {
        const sourcePath = path.join(
          this.#attachmentsDirectory,
          issue.audioFileName,
        );
        if (existsSync(sourcePath)) {
          audioFiles.push({
            data: readFileSync(sourcePath),
            path: `attachments/${issue.id}.${path.extname(issue.audioFileName).slice(1)}`,
          });
        }
      }
      return toClientIssue(issue);
    });
    const manifest = {
      app: { name: this.#appName, version: this.#appVersion },
      archiveVersion: 1,
      exportedAt: exportedAt.toISOString(),
      issueIds: selected.map(({ id }) => id),
      privacy: {
        audioIncluded: audioFiles.length > 0,
        requestBodiesCollected: false,
        secretsCollected: false,
        transcriptionTextCollected: false,
      },
    };
    const system = {
      architecture: arch(),
      electronVersion: process.versions.electron,
      nodeVersion: process.versions.node,
      operatingSystem: platform(),
      operatingSystemRelease: release(),
    };
    const entries: DiagnosticArchiveEntry[] = [
      {
        data: JSON.stringify(manifest, null, 2),
        path: 'manifest.json',
      },
      {
        data: JSON.stringify(clientIssues, null, 2),
        path: 'issues.json',
      },
      { data: JSON.stringify(system, null, 2), path: 'system.json' },
      {
        data:
          'This UnTypo diagnostic package contains redacted application and API metadata.\r\n' +
          'It never contains API keys, authorization headers, request bodies, or transcription text.\r\n' +
          `Recording audio included: ${audioFiles.length > 0 ? 'yes' : 'no'}\r\n`,
        path: 'README.txt',
      },
      ...this.logArchiveEntries(),
      ...audioFiles,
    ];
    this.log({
      context: {
        audioIncluded: audioFiles.length > 0,
        issueCount: selected.length,
      },
      message: 'Diagnostic archive generated',
      scope: 'diagnostics.export',
    });
    return createDiagnosticZip(entries, exportedAt);
  }

  createLoggedFetch(context: ProviderRequestContext): typeof fetch {
    const loggedFetch = async (
      input: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      const requestId = randomUUID();
      const startedAt = this.#now();
      const request = input instanceof Request ? input : undefined;
      const requestUrl =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const endpoint = sanitizeDiagnosticEndpoint(request?.url ?? requestUrl);
      const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();
      const body = init?.body ?? request?.body;
      const contentType =
        headerValue(init?.headers, 'content-type') ??
        request?.headers.get('content-type') ??
        undefined;
      this.log({
        context: {
          ...(contentType ? { contentType } : {}),
          endpoint,
          hasRequestBody: body !== undefined && body !== null,
          method,
          model: context.model,
          profileId: context.profileId,
          providerId: context.providerId,
          requestId,
          ...(requestBodySize(body) !== undefined
            ? { payloadSizeBytes: requestBodySize(body)! }
            : {}),
        },
        message: 'Provider API request started',
        scope: 'provider.http',
      });
      try {
        const response = await fetch(input, init);
        const providerRequestId =
          response.headers.get('x-request-id') ??
          response.headers.get('request-id') ??
          response.headers.get('x-dashscope-request-id') ??
          undefined;
        this.log({
          context: {
            durationMs: this.#now() - startedAt,
            endpoint,
            method,
            ...(providerRequestId ? { providerRequestId } : {}),
            requestId,
            status: response.status,
          },
          level: response.ok ? 'info' : 'error',
          message: 'Provider API response received',
          scope: 'provider.http',
        });
        return response;
      } catch (error) {
        this.log({
          context: {
            durationMs: this.#now() - startedAt,
            endpoint,
            error: normalizeError(error),
            method,
            requestId,
          },
          level: 'error',
          message: 'Provider API request failed before a response',
          scope: 'provider.http',
        });
        throw error;
      }
    };
    return loggedFetch;
  }

  log(input: DiagnosticLogInput): ClientDiagnosticLogEntry {
    const operationId =
      input.operationId ?? this.#operation.getStore()?.operationId;
    const entry: ClientDiagnosticLogEntry = {
      ...(input.context
        ? { context: sanitizeDiagnosticContext(input.context) ?? {} }
        : {}),
      id: randomUUID(),
      level: input.level ?? 'info',
      message: redactDiagnosticText(input.message),
      ...(operationId ? { operationId } : {}),
      scope: redactDiagnosticText(input.scope).slice(0, 120),
      timestamp: this.#now(),
    };
    this.#recentEntries.push(entry);
    if (this.#recentEntries.length > maxRecentEntries) {
      this.#recentEntries.splice(
        0,
        this.#recentEntries.length - maxRecentEntries,
      );
    }
    try {
      appendFileSync(this.currentLogPath(), `${JSON.stringify(entry)}\n`, {
        encoding: 'utf8',
      });
    } catch (error) {
      console.error('Diagnostic log write failed', error);
    }
    return entry;
  }

  onChanged(listener: () => void): () => void {
    this.#changedListeners.add(listener);
    return () => this.#changedListeners.delete(listener);
  }

  recordIssue(input: DiagnosticIssueInput): ClientDiagnosticIssue {
    const occurredAt = this.#now();
    const operationId =
      input.operationId ?? this.#operation.getStore()?.operationId;
    const error = normalizeError(input.error);
    const errorEntry = this.log({
      context: input.context,
      level: 'error',
      message: error.message,
      ...(operationId ? { operationId } : {}),
      scope: input.source,
    });
    const id = randomUUID();
    let audioFileName: string | undefined;
    if (input.audio && input.audio.bytes.byteLength > 0) {
      const fileName = `${id}.${audioExtension(input.audio.mimeType)}`;
      try {
        writeFileSync(
          path.join(this.#attachmentsDirectory, fileName),
          input.audio.bytes,
        );
        audioFileName = fileName;
      } catch (audioError) {
        this.log({
          context: { error: normalizeError(audioError), issueId: id },
          level: 'warning',
          message: 'Failed to retain the diagnostic recording attachment',
          ...(operationId ? { operationId } : {}),
          scope: 'diagnostics.attachment',
        });
      }
    }
    const issue: StoredDiagnosticIssue = {
      ...(audioFileName ? { audioFileName } : {}),
      audioAvailable: audioFileName !== undefined,
      ...(input.context
        ? { context: sanitizeDiagnosticContext(input.context) ?? {} }
        : {}),
      error,
      id,
      kind: input.kind,
      occurredAt,
      ...(operationId ? { operationId } : {}),
      source: redactDiagnosticText(input.source).slice(0, 120),
      timeline: [
        ...this.#recentEntries
          .filter((entry) => entry.id !== errorEntry.id)
          .slice(-(maxTimelineEntries - 1)),
        errorEntry,
      ],
    };
    this.#issues.unshift(issue);
    this.#issues = this.#issues.slice(0, 100);
    this.persistIssues();
    this.emitChanged();
    return toClientIssue(issue);
  }

  recordRendererIssue(input: ClientRendererIssueInput): ClientDiagnosticIssue {
    const error = new Error(input.message);
    error.name = 'RendererError';
    if (input.stack) error.stack = input.stack;
    return this.recordIssue({
      context: {
        ...(input.column !== undefined ? { column: input.column } : {}),
        ...(input.line !== undefined ? { line: input.line } : {}),
        ...(input.source ? { scriptSource: input.source } : {}),
      },
      error,
      kind: 'renderer',
      source: 'renderer.runtime',
    });
  }

  runWithOperation<T>(
    operationId: string,
    action: () => Promise<T>,
  ): Promise<T> {
    return this.#operation.run({ operationId }, action);
  }

  snapshot(): ClientDiagnosticSnapshot {
    return {
      generatedAt: this.#now(),
      issues: this.#issues.map((issue) =>
        structuredClone(toClientIssue(issue)),
      ),
      privacy: {
        audioExportIsOptIn: true,
        requestBodiesCollected: false,
        secretsCollected: false,
        transcriptionTextCollected: false,
      },
      retentionDays: this.#retentionDays,
    };
  }

  private cleanupExpiredData(): void {
    const cutoff = this.#now() - this.#retentionDays * 24 * 60 * 60 * 1_000;
    for (const fileName of readdirSync(this.#logsDirectory)) {
      const filePath = path.join(this.#logsDirectory, fileName);
      try {
        if (statSync(filePath).mtimeMs < cutoff) unlinkSync(filePath);
      } catch {
        // Retention cleanup is best-effort and must never block startup.
      }
    }
    const retained: StoredDiagnosticIssue[] = [];
    for (const issue of this.#issues) {
      if (issue.occurredAt < cutoff) {
        if (issue.audioFileName) this.removeAttachment(issue.audioFileName);
      } else {
        retained.push(issue);
      }
    }
    if (retained.length !== this.#issues.length) {
      this.#issues = retained;
      this.persistIssues();
    }
  }

  private currentLogPath(): string {
    const day = new Date(this.#now()).toISOString().slice(0, 10);
    let candidate = path.join(this.#logsDirectory, `${day}.jsonl`);
    try {
      if (existsSync(candidate) && statSync(candidate).size >= maxLogBytes) {
        candidate = path.join(
          this.#logsDirectory,
          `${day}-${this.#sessionId}.jsonl`,
        );
      }
    } catch {
      // appendFileSync below will surface any real write failure.
    }
    return candidate;
  }

  private emitChanged(): void {
    for (const listener of this.#changedListeners) {
      try {
        listener();
      } catch (error) {
        console.error('Diagnostic change listener failed', error);
      }
    }
  }

  private loadIssues(): void {
    try {
      if (!existsSync(this.#issuesPath)) return;
      this.#issues = parseStoredIssues(
        JSON.parse(readFileSync(this.#issuesPath, 'utf8')) as unknown,
      );
    } catch (error) {
      console.error('Diagnostic issue index could not be read', error);
      this.#issues = [];
    }
  }

  private logArchiveEntries(): DiagnosticArchiveEntry[] {
    return readdirSync(this.#logsDirectory)
      .filter((fileName) => fileName.endsWith('.jsonl'))
      .sort()
      .map((fileName) => ({
        data: readFileSync(path.join(this.#logsDirectory, fileName)),
        path: `logs/${fileName}`,
      }));
  }

  private persistIssues(): void {
    const temporaryPath = `${this.#issuesPath}.tmp`;
    try {
      writeFileSync(
        temporaryPath,
        JSON.stringify({ issues: this.#issues, version: issuesFileVersion }),
        { encoding: 'utf8', mode: 0o600 },
      );
      renameSync(temporaryPath, this.#issuesPath);
    } catch (error) {
      console.error('Diagnostic issue index write failed', error);
      try {
        if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
      } catch {
        // Nothing else can be recovered safely here.
      }
    }
  }

  private removeAttachment(fileName: string): void {
    if (path.basename(fileName) !== fileName) return;
    try {
      const filePath = path.join(this.#attachmentsDirectory, fileName);
      if (existsSync(filePath)) unlinkSync(filePath);
    } catch (error) {
      console.error('Diagnostic attachment cleanup failed', error);
    }
  }
}
