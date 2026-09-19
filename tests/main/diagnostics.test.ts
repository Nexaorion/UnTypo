import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DiagnosticCollector } from '../../src/main/diagnostics/collector';
import {
  redactDiagnosticText,
  sanitizeDiagnosticContext,
  sanitizeDiagnosticEndpoint,
} from '../../src/main/diagnostics/redaction';

const temporaryDirectories: string[] = [];
const collectors: DiagnosticCollector[] = [];

const temporaryDirectory = (): string => {
  const directory = mkdtempSync(path.join(tmpdir(), 'untypo-diagnostics-'));
  temporaryDirectories.push(directory);
  return directory;
};

const createCollector = (
  options: ConstructorParameters<typeof DiagnosticCollector>[0],
): DiagnosticCollector => {
  const collector = new DiagnosticCollector(options);
  collectors.push(collector);
  return collector;
};

const unzipEntries = (archive: Buffer): ReadonlyMap<string, Buffer> => {
  const entries = new Map<string, Buffer>();
  let offset = 0;
  while (archive.readUInt32LE(offset) === 0x04034b50) {
    const method = archive.readUInt16LE(offset + 8);
    const compressedSize = archive.readUInt32LE(offset + 18);
    const nameLength = archive.readUInt16LE(offset + 26);
    const extraLength = archive.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const name = archive.subarray(nameStart, nameStart + nameLength).toString();
    const dataStart = nameStart + nameLength + extraLength;
    const compressed = archive.subarray(dataStart, dataStart + compressedSize);
    entries.set(name, method === 8 ? inflateRawSync(compressed) : Buffer.from(compressed));
    offset = dataStart + compressedSize;
  }
  return entries;
};

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(collectors.splice(0).map((collector) => collector.flush()));
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('diagnostic redaction', () => {
  it('removes credentials, query secrets, audio data, and local user names', () => {
    const redacted = redactDiagnosticText(
      'Bearer top-secret sk-live-secret12345678 C:\\Users\\Alice\\file.ts ' +
        'https://example.test/path?token=private data:audio/webm;base64,AAAAAA',
    );

    expect(redacted).not.toContain('top-secret');
    expect(redacted).not.toContain('sk-live-secret12345678');
    expect(redacted).not.toContain('Alice');
    expect(redacted).not.toContain('private');
    expect(redacted).not.toContain('AAAAAA');
    expect(sanitizeDiagnosticEndpoint('https://u:p@example.test/v1?q=secret')).toBe(
      'https://example.test/v1',
    );
  });

  it('redacts audio data URLs without ambiguous separators', () => {
    expect(
      redactDiagnosticText(
        'data:audio/ogg;codecs=opus;base64,AQID ' +
          'data:audio/mp4;charset=utf-8;base64,AQID ' +
          'data:audio/wav,%52%49%46%46 ' +
          'data:audio/ogg,AAAA,secret',
      ),
    ).toBe(
      'data:audio/[redacted] data:audio/[redacted] ' +
        'data:audio/[redacted] data:audio/[redacted]',
    );

    const malformed = `data:audio/webm${';!'.repeat(500)}`;
    expect(redactDiagnosticText(malformed)).toBe(malformed);
  });

  it('redacts sensitive fields while keeping safe request metadata', () => {
    expect(
      sanitizeDiagnosticContext({
        apiKey: 'secret',
        authorization: 'Bearer secret',
        endpoint: 'https://example.test/v1',
        payloadSizeBytes: 4096,
        requestBody: { model: 'secret-payload' },
        status: 400,
      }),
    ).toEqual({
      apiKey: '[redacted]',
      authorization: '[redacted]',
      endpoint: 'https://example.test/v1',
      payloadSizeBytes: 4096,
      requestBody: '[redacted]',
      status: 400,
    });
  });
});

describe('DiagnosticCollector', () => {
  it('clears issues, collected logs, and recording attachments together', async () => {
    const rootDirectory = temporaryDirectory();
    const collector = createCollector({
      appName: 'UnTypo',
      appVersion: '0.1.0',
      rootDirectory,
    });
    await collector.flush();
    collector.recordIssue({
      audio: {
        bytes: new Uint8Array([1, 2, 3, 4]),
        channels: 1,
        durationMs: 120,
        mimeType: 'audio/webm;codecs=opus',
        sampleRateHz: 48_000,
      },
      error: new Error('Collected issue'),
      kind: 'internal',
      source: 'test.clear',
    });

    const snapshot = await collector.clear();

    expect(snapshot.issues).toEqual([]);
    expect(readdirSync(path.join(rootDirectory, 'attachments'))).toEqual([]);
    expect(readdirSync(path.join(rootDirectory, 'logs'))).toEqual([]);
    expect(JSON.parse(readFileSync(path.join(rootDirectory, 'issues.json'), 'utf8'))).toEqual({
      issues: [],
      version: 1,
    });
  });

  it('stops persisting logs and issues while automatic collection is disabled', async () => {
    const rootDirectory = temporaryDirectory();
    const collector = createCollector({
      appName: 'UnTypo',
      appVersion: '0.1.0',
      rootDirectory,
    });
    await collector.flush();
    const logsDirectory = path.join(rootDirectory, 'logs');
    const logFiles = readdirSync(logsDirectory);
    const originalLogs = logFiles.map((fileName) =>
      readFileSync(path.join(logsDirectory, fileName), 'utf8'),
    );

    collector.setEnabled(false);
    collector.log({ message: 'Disabled log', scope: 'test.disabled' });
    collector.recordIssue({
      audio: {
        bytes: new Uint8Array([1, 2, 3, 4]),
        channels: 1,
        durationMs: 120,
        mimeType: 'audio/webm;codecs=opus',
        sampleRateHz: 48_000,
      },
      error: new Error('Disabled issue'),
      kind: 'internal',
      source: 'test.disabled',
    });

    expect(collector.snapshot().issues).toEqual([]);
    expect(readdirSync(logsDirectory)).toEqual(logFiles);
    expect(
      logFiles.map((fileName) => readFileSync(path.join(logsDirectory, fileName), 'utf8')),
    ).toEqual(originalLogs);
    expect(readdirSync(path.join(rootDirectory, 'attachments'))).toEqual([]);

    collector.setEnabled(true);
    collector.recordIssue({
      error: new Error('Enabled issue'),
      kind: 'internal',
      source: 'test.enabled',
    });
    expect(collector.snapshot().issues).toHaveLength(1);
  });

  it('persists a redacted issue and exports audio only with explicit opt-in', async () => {
    let now = Date.UTC(2026, 7, 24, 10, 0, 0);
    const rootDirectory = temporaryDirectory();
    const collector = createCollector({
      appName: 'UnTypo',
      appVersion: '0.1.0',
      now: () => now,
      rootDirectory,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response('{}', {
            headers: { 'x-request-id': 'provider-request-123' },
            status: 400,
          }),
        ),
      ),
    );
    const loggedFetch = collector.createLoggedFetch({
      model: 'qwen-audio',
      profileId: 'speech-primary',
      providerId: 'aliyun-bailian-speech',
    });
    await loggedFetch('https://provider.example.test/v1?token=private', {
      body: JSON.stringify({ apiKey: 'must-not-leak', audioData: 'AAAA' }),
      headers: { Authorization: 'Bearer must-not-leak' },
      method: 'POST',
    });
    now += 200;
    const issue = collector.recordIssue({
      audio: {
        bytes: new Uint8Array([1, 2, 3, 4]),
        channels: 1,
        durationMs: 120,
        mimeType: 'audio/webm;codecs=opus',
        sampleRateHz: 48_000,
      },
      context: {
        apiKey: 'must-not-leak',
        durationMs: 120,
        payloadSizeBytes: 4,
      },
      error: new Error('Aliyun failed: Bearer must-not-leak sk-live-secret12345678'),
      kind: 'provider',
      source: 'provider.speech-processing',
    });
    await collector.flush();

    const snapshot = collector.snapshot();
    expect(snapshot.issues).toHaveLength(1);
    expect(snapshot.issues[0]).toMatchObject({
      audioAvailable: true,
      id: issue.id,
      kind: 'provider',
    });
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain('must-not-leak');
    expect(serialized).not.toContain('private');
    expect(serialized).toContain('provider-request-123');
    expect(serialized).toContain('payloadSizeBytes');

    const withoutAudio = unzipEntries(
      collector.buildArchive({ includeAudio: false, issueIds: [issue.id] }),
    );
    expect([...withoutAudio.keys()]).not.toContain(`attachments/${issue.id}.webm`);
    const manifestWithoutAudio = JSON.parse(withoutAudio.get('manifest.json')!.toString()) as {
      privacy: { audioIncluded: boolean };
    };
    expect(manifestWithoutAudio.privacy.audioIncluded).toBe(false);

    const withAudio = unzipEntries(
      collector.buildArchive({ includeAudio: true, issueIds: [issue.id] }),
    );
    expect(withAudio.get(`attachments/${issue.id}.webm`)).toEqual(Buffer.from([1, 2, 3, 4]));
    expect([...withAudio.keys()]).toContain('issues.json');
    expect([...withAudio.keys()].some((name) => name.startsWith('logs/'))).toBe(true);

    const reloaded = createCollector({
      appName: 'UnTypo',
      appVersion: '0.1.0',
      now: () => now,
      rootDirectory,
    });
    expect(reloaded.snapshot().issues[0]?.id).toBe(issue.id);
    const acknowledged = reloaded.acknowledge([issue.id]);
    expect(acknowledged.issues[0]).toMatchObject({
      audioAvailable: false,
      id: issue.id,
    });
    expect(readdirSync(path.join(rootDirectory, 'attachments'))).toEqual([]);
    expect(readFileSync(path.join(rootDirectory, 'issues.json'), 'utf8')).not.toContain(
      'audioFileName',
    );
  });

  it('removes expired issues and their recordings even when they were not acknowledged', async () => {
    let now = Date.UTC(2026, 7, 1, 10, 0, 0);
    const rootDirectory = temporaryDirectory();
    const collector = createCollector({
      appName: 'UnTypo',
      appVersion: '0.1.0',
      now: () => now,
      rootDirectory,
    });
    collector.recordIssue({
      audio: {
        bytes: new Uint8Array([1, 2, 3, 4]),
        channels: 1,
        durationMs: 120,
        mimeType: 'audio/webm;codecs=opus',
        sampleRateHz: 48_000,
      },
      error: new Error('Speech provider failed'),
      kind: 'provider',
      source: 'provider.speech-processing',
    });
    await collector.flush();

    now += 15 * 24 * 60 * 60 * 1_000;
    const reloaded = createCollector({
      appName: 'UnTypo',
      appVersion: '0.1.0',
      now: () => now,
      rootDirectory,
    });

    expect(reloaded.snapshot().issues).toEqual([]);
    expect(readdirSync(path.join(rootDirectory, 'attachments'))).toEqual([]);
  });

  it('writes redacted log lines in order after flush', async () => {
    const rootDirectory = temporaryDirectory();
    const collector = createCollector({
      appName: 'UnTypo',
      appVersion: '0.1.0',
      rootDirectory,
    });
    collector.log({
      context: { apiKey: 'must-not-leak' },
      message: 'First Bearer must-not-leak',
      scope: 'test.order',
    });
    collector.log({ message: 'Second', scope: 'test.order' });
    await collector.flush();

    const logsDirectory = path.join(rootDirectory, 'logs');
    const contents = readdirSync(logsDirectory)
      .map((fileName) => readFileSync(path.join(logsDirectory, fileName), 'utf8'))
      .join('');
    expect(contents).toContain('"message":"First Bearer [redacted]"');
    expect(contents).toContain('"message":"Second"');
    expect(contents).not.toContain('must-not-leak');
    expect(contents.indexOf('First Bearer')).toBeLessThan(contents.indexOf('"message":"Second"'));
  });
});
