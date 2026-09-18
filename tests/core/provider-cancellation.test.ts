import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OpenAIProvider } from '../../src/core/providers/openai-provider';
import { OpenAICompatibleTextProvider } from '../../src/core/providers/openai-compatible-text-provider';

type ServerBehavior = 'hang-headers' | 'hang-event-stream';

let behavior: ServerBehavior = 'hang-headers';
let server: Server;
let baseUrl = '';

const audio = {
  bytes: new Uint8Array([1, 2, 3]),
  channels: 1,
  durationMs: 1_000,
  mimeType: 'audio/webm;codecs=opus',
  sampleRateHz: 48_000,
};

const createTextProvider = (): OpenAICompatibleTextProvider =>
  new OpenAICompatibleTextProvider({
    allowInsecurePrivateEndpoint: true,
    apiKey: 'sk-test-secret',
    baseUrl,
    displayName: 'Local test provider',
    id: 'local-test',
    model: 'test-model',
  });

const createSpeechProvider = (): OpenAIProvider =>
  new OpenAIProvider({
    allowInsecurePrivateEndpoint: true,
    apiKey: 'sk-test-secret',
    baseUrl,
    textModel: 'test-model',
    transcriptionModel: 'test-transcription-model',
  });

const waitForFirstDelta = async (deltas: readonly string[]): Promise<void> => {
  const deadline = Date.now() + 2_000;
  while (deltas.length === 0) {
    if (Date.now() > deadline) throw new Error('Stream never produced a delta');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

const settledWithin = async (
  operation: Promise<unknown>,
  milliseconds: number,
): Promise<'settled' | 'pending'> =>
  Promise.race([
    operation.then(
      () => 'settled' as const,
      () => 'settled' as const,
    ),
    new Promise<'pending'>((resolve) =>
      setTimeout(() => resolve('pending'), milliseconds),
    ),
  ]);

describe('provider cancellation', () => {
  beforeAll(async () => {
    server = createServer((request, response) => {
      if (behavior === 'hang-headers') return;
      if (request.url !== '/v1/chat/completions') {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.write(
        `data: ${JSON.stringify({
          choices: [{ delta: { content: '{"outputText":"Hel' } }],
        })}\n\n`,
      );
    });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address() as AddressInfo | null;
    if (!address) throw new Error('Test server did not expose a port');
    baseUrl = `http://127.0.0.1:${String(address.port)}/v1`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it('aborts while response headers are still pending', async () => {
    behavior = 'hang-headers';
    const controller = new AbortController();
    const pending = createTextProvider().processTranscript('hello', {
      dictionary: [],
      locale: 'en-US',
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 50);

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('aborts a hanging event stream body after the first delta', async () => {
    behavior = 'hang-event-stream';
    const controller = new AbortController();
    const deltas: string[] = [];
    const pending = createTextProvider().processTranscript('hello', {
      dictionary: [],
      locale: 'en-US',
      onOutputTextUpdate: (outputText) => deltas.push(outputText),
      signal: controller.signal,
    });
    await waitForFirstDelta(deltas);
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(deltas).toEqual(['Hel']);
  });

  it('aborts speech recognition waiting for response headers', async () => {
    behavior = 'hang-headers';
    const controller = new AbortController();
    const pending = createSpeechProvider().transcribe(audio, {
      dictionary: [],
      language: 'en-US',
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 50);

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('applies no default deadline to an un-aborted request', async () => {
    behavior = 'hang-headers';
    const controller = new AbortController();
    const pending = createTextProvider().processTranscript('hello', {
      dictionary: [],
      locale: 'en-US',
      signal: controller.signal,
    });

    await expect(settledWithin(pending, 250)).resolves.toBe('pending');

    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
