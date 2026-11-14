import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
  CONNECTION_CHECK_PHRASE,
  ConnectionCheckError,
  audioPayloadFromWav,
  connectionTranscriptMatches,
  finishConnectionCheck,
  loadConnectionCheckAudio,
  normalizeConnectionCheckError,
  resolveConnectionCheckAudioPath,
} from '../../src/core/providers/connection-check';
import { ProviderContractError } from '../../src/core/providers/types';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('connection transcript comparison', () => {
  it.each([
    'This is a connection test.',
    'THIS IS A CONNECTION TEST',
    'this is a connection test',
    'This is a connection test!',
    'this   is\ta connection test',
    'Okay. This is a connection test.',
    'this is connection test',
    'this is a connections test',
  ])('accepts %j', (transcript) => {
    expect(connectionTranscriptMatches(transcript)).toBe(true);
  });

  it.each(['', '   ', '...', 'hello world', 'connection test', 'this test connection'])(
    'rejects %j',
    (transcript) => {
      expect(connectionTranscriptMatches(transcript)).toBe(false);
    },
  );

  it('classifies an empty recognition separately from a mismatch', async () => {
    await expect(
      finishConnectionCheck(() => Promise.resolve({ text: ' . ' })),
    ).rejects.toMatchObject({
      failure: 'empty',
      message: 'Connection check returned no transcript',
    });
    const hidden = 'private transcript should stay hidden';
    await expect(finishConnectionCheck(() => Promise.resolve({ text: hidden }))).rejects.toSatisfy(
      (error: unknown) => {
        expect(error).toMatchObject({
          failure: 'mismatch',
          message: 'Connection check transcript did not match',
        });
        expect(String(error)).not.toContain(hidden);
        return true;
      },
    );
  });
});

describe('connection check errors', () => {
  it('keeps authentication and network failures distinct from recognition', () => {
    const authentication = new Error(
      'DeepSeek ASR request failed with status 401: Invalid API key',
    );
    const network = new TypeError('fetch failed');
    expect(normalizeConnectionCheckError(authentication)).toBe(authentication);
    expect(normalizeConnectionCheckError(network)).toBe(network);
    expect(normalizeConnectionCheckError(authentication).message).not.toContain('sk-');
  });

  it('maps an abort to cancellation and leaves a timeout unchanged', () => {
    const aborted = new Error('The operation was aborted');
    aborted.name = 'AbortError';
    const timeout = new Error('The operation was aborted due to timeout');
    timeout.name = 'TimeoutError';
    expect(normalizeConnectionCheckError(aborted)).toMatchObject({
      failure: 'cancelled',
      message: 'Connection check was cancelled',
    });
    expect(normalizeConnectionCheckError(timeout)).toBe(timeout);
    expect(
      normalizeConnectionCheckError(
        new ProviderContractError('EMPTY_RESULT', 'DeepSeek ASR returned an empty transcript'),
      ),
    ).toBeInstanceOf(ConnectionCheckError);
  });

  it('cancels before recognition when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    let called = false;
    await expect(
      finishConnectionCheck(() => {
        called = true;
        return Promise.resolve({ text: CONNECTION_CHECK_PHRASE });
      }, controller.signal),
    ).rejects.toMatchObject({ failure: 'cancelled' });
    expect(called).toBe(false);
  });
});

describe('bundled connection audio', () => {
  it('loads a short 16 kHz spoken WAV and documents its source', () => {
    const audio = loadConnectionCheckAudio();
    const note = readFileSync(path.join(repoRoot, 'assets/connection-check.txt'), 'utf8');
    const builder = readFileSync(path.join(repoRoot, 'electron-builder.yml'), 'utf8');

    expect(audio).toMatchObject({
      channels: 1,
      mimeType: 'audio/wav',
      sampleRateHz: 16_000,
    });
    expect(audio.durationMs).toBeGreaterThanOrEqual(200);
    expect(audio.durationMs).toBeLessThanOrEqual(5_000);
    expect(audio.bytes.byteLength).toBe(61_962);
    expect(note).toContain(CONNECTION_CHECK_PHRASE);
    expect(note).toContain('eSpeak NG 1.51');
    expect(note).toContain('GPL-3.0-or-later');
    expect(builder).toContain('from: assets/connection-check.wav');
    expect(builder).toContain('to: connection-check.wav');
  });

  it('reads the copy installed into the packaged resources directory', () => {
    const resourcesPath = mkdtempSync(path.join(tmpdir(), 'untypo-connection-'));
    temporaryDirectories.push(resourcesPath);
    const source = loadConnectionCheckAudio().bytes;
    writeFileSync(path.join(resourcesPath, 'connection-check.wav'), source);

    const packaged = loadConnectionCheckAudio({ isPackaged: true, resourcesPath });

    expect(resolveConnectionCheckAudioPath({ isPackaged: true, resourcesPath })).toBe(
      path.join(resourcesPath, 'connection-check.wav'),
    );
    expect(packaged.bytes).toEqual(source);
  });

  it('does not fall back to the development file when the packaged copy is missing', () => {
    const resourcesPath = mkdtempSync(path.join(tmpdir(), 'untypo-connection-missing-'));
    temporaryDirectories.push(resourcesPath);

    expect(() => loadConnectionCheckAudio({ isPackaged: true, resourcesPath })).toThrow(
      'Connection check audio is unavailable',
    );
  });

  it('rejects a WAV that is not the spoken fixture format', () => {
    const bytes = new Uint8Array(44);
    bytes.set([82, 73, 70, 70], 0);
    expect(() => audioPayloadFromWav(bytes)).toThrow(
      'Connection check audio is not 16-bit PCM WAV',
    );
  });
});
