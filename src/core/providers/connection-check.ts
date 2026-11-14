import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { ProviderContractError, type AudioPayload } from './types.js';

/** Spoken text of assets/connection-check.wav. The note beside that file records how it was synthesized. */
export const CONNECTION_CHECK_PHRASE = 'This is a connection test.';
export const CONNECTION_CHECK_ASSET_NAME = 'connection-check.wav';

export type ConnectionCheckFailure = 'cancelled' | 'empty' | 'mismatch';

export class ConnectionCheckError extends Error {
  readonly failure: ConnectionCheckFailure;

  constructor(failure: ConnectionCheckFailure, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ConnectionCheckError';
    this.failure = failure;
  }
}

export interface ConnectionCheckLocation {
  appPath?: string;
  isPackaged?: boolean;
  resourcesPath?: string;
}

const cancelledMessage = 'Connection check was cancelled';
const emptyMessage = 'Connection check returned no transcript';
const mismatchMessage = 'Connection check transcript did not match';
const unavailableMessage = 'Connection check audio is unavailable';

export const normalizeConnectionTranscript = (text: string): string =>
  text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/ +/gu, ' ');

const levenshtein = (left: string, right: string): number => {
  const previous = Array.from({ length: right.length + 1 }, (_value, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = previous[0] ?? 0;
    previous[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const nextDiagonal = previous[rightIndex] ?? 0;
      const substitution = left[leftIndex - 1] === right[rightIndex - 1] ? diagonal : diagonal + 1;
      previous[rightIndex] = Math.min(
        (previous[rightIndex - 1] ?? 0) + 1,
        nextDiagonal + 1,
        substitution,
      );
      diagonal = nextDiagonal;
    }
  }
  return previous[right.length] ?? 0;
};

const tokensClose = (expected: string, actual: string): boolean => {
  if (expected === actual) return true;
  if (expected.length < 4 || actual.length < 4) return false;
  return levenshtein(expected, actual) <= 1;
};

const containsPhrase = (actual: string, expected: string): boolean =>
  actual === expected ||
  actual.startsWith(`${expected} `) ||
  actual.endsWith(` ${expected}`) ||
  actual.includes(` ${expected} `);

export const connectionTranscriptMatches = (
  actual: string,
  expected: string = CONNECTION_CHECK_PHRASE,
): boolean => {
  const normalizedActual = normalizeConnectionTranscript(actual);
  const normalizedExpected = normalizeConnectionTranscript(expected);
  if (!normalizedActual || !normalizedExpected) return false;
  if (containsPhrase(normalizedActual, normalizedExpected)) return true;

  const expectedTokens = normalizedExpected.split(' ');
  const actualTokens = normalizedActual.split(' ');
  if (actualTokens.length > expectedTokens.length + 4) return false;
  // Short function words can be dropped; the remaining words must stay in order.
  const required = expectedTokens.filter((token) => token.length >= 4);
  let cursor = 0;
  for (const token of required) {
    let found = -1;
    for (let index = cursor; index < actualTokens.length; index += 1) {
      const candidate = actualTokens[index];
      if (candidate && tokensClose(token, candidate)) {
        found = index;
        break;
      }
    }
    if (found < 0) return false;
    cursor = found + 1;
  }
  return required.length > 0;
};

export const assertConnectionCheckTranscript = (text: string): void => {
  if (!normalizeConnectionTranscript(text)) {
    throw new ConnectionCheckError('empty', emptyMessage);
  }
  if (!connectionTranscriptMatches(text)) {
    throw new ConnectionCheckError('mismatch', mismatchMessage);
  }
};

const isTimeout = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  if (error.name === 'TimeoutError') return true;
  const message = error.message.toLowerCase();
  return message.includes('timeout') || message.includes('timed out');
};

const isAbort = (error: unknown): boolean => {
  if (isTimeout(error)) return false;
  if (error instanceof ProviderContractError && error.code === 'ABORTED') return true;
  return error instanceof Error && error.name === 'AbortError';
};

export const normalizeConnectionCheckError = (error: unknown): Error => {
  if (error instanceof ConnectionCheckError) return error;
  if (isTimeout(error)) {
    return error instanceof Error ? error : new Error('Connection check timed out');
  }
  if (isAbort(error)) {
    return new ConnectionCheckError('cancelled', cancelledMessage, { cause: error });
  }
  if (error instanceof ProviderContractError && error.code === 'EMPTY_RESULT') {
    return new ConnectionCheckError('empty', emptyMessage, { cause: error });
  }
  if (error instanceof Error) return error;
  return new Error('Connection check failed');
};

export const finishConnectionCheck = async (
  recognize: () => Promise<{ text: string }>,
  signal?: AbortSignal,
): Promise<void> => {
  if (signal?.aborted) {
    throw new ConnectionCheckError('cancelled', cancelledMessage);
  }
  try {
    const result = await recognize();
    assertConnectionCheckTranscript(result.text);
  } catch (error) {
    throw normalizeConnectionCheckError(error);
  }
};

const developmentCandidates = (location: ConnectionCheckLocation): readonly string[] => {
  const candidates = [path.join(process.cwd(), 'assets', CONNECTION_CHECK_ASSET_NAME)];
  if (location.appPath) {
    candidates.unshift(path.join(location.appPath, 'assets', CONNECTION_CHECK_ASSET_NAME));
  }
  return candidates;
};

export const resolveConnectionCheckAudioPath = (location: ConnectionCheckLocation = {}): string => {
  if (location.isPackaged) {
    if (!location.resourcesPath) throw new Error(unavailableMessage);
    const packagedPath = path.join(location.resourcesPath, CONNECTION_CHECK_ASSET_NAME);
    if (!existsSync(packagedPath)) throw new Error(unavailableMessage);
    return packagedPath;
  }
  const candidate = developmentCandidates(location).find((filePath) => existsSync(filePath));
  if (!candidate) throw new Error(unavailableMessage);
  return candidate;
};

const readAscii = (bytes: Uint8Array, offset: number, length: number): string => {
  let value = '';
  for (let index = 0; index < length; index += 1) {
    value += String.fromCharCode(bytes[offset + index] ?? 0);
  }
  return value;
};

export const audioPayloadFromWav = (bytes: Uint8Array): AudioPayload => {
  const invalid = (): Error => new Error('Connection check audio is not 16-bit PCM WAV');
  if (
    bytes.byteLength < 44 ||
    readAscii(bytes, 0, 4) !== 'RIFF' ||
    readAscii(bytes, 8, 4) !== 'WAVE'
  ) {
    throw invalid();
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let channels = 0;
  let sampleRateHz = 0;
  let bitsPerSample = 0;
  let dataOffset = -1;
  let dataSize = 0;
  let offset = 12;
  while (offset + 8 <= bytes.byteLength) {
    const chunkId = readAscii(bytes, offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const chunkStart = offset + 8;
    if (chunkStart + chunkSize > bytes.byteLength) throw invalid();
    if (chunkId === 'fmt ') {
      if (chunkSize < 16) throw invalid();
      channels = view.getUint16(chunkStart + 2, true);
      sampleRateHz = view.getUint32(chunkStart + 4, true);
      bitsPerSample = view.getUint16(chunkStart + 14, true);
      if (view.getUint16(chunkStart, true) !== 1) throw invalid();
    } else if (chunkId === 'data' && dataOffset < 0) {
      dataOffset = chunkStart;
      dataSize = chunkSize;
    }
    offset = chunkStart + chunkSize + (chunkSize % 2);
  }
  if (
    channels !== 1 ||
    sampleRateHz !== 16_000 ||
    bitsPerSample !== 16 ||
    dataOffset < 0 ||
    dataSize <= 0 ||
    dataSize % 2 !== 0
  ) {
    throw invalid();
  }
  const durationMs = Math.round(((dataSize / 2) * 1_000) / sampleRateHz);
  if (durationMs < 200 || durationMs > 5_000) throw invalid();
  // Providers detect WAV from the container, so the payload keeps the header.
  return {
    bytes: Uint8Array.from(bytes),
    channels,
    durationMs,
    mimeType: 'audio/wav',
    sampleRateHz,
  };
};

export const loadConnectionCheckAudio = (location: ConnectionCheckLocation = {}): AudioPayload => {
  const filePath = resolveConnectionCheckAudioPath(location);
  try {
    return audioPayloadFromWav(readFileSync(filePath));
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === 'Connection check audio is not 16-bit PCM WAV'
    ) {
      throw error;
    }
    throw new Error(unavailableMessage, { cause: error });
  }
};
