import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getAppPath: () => process.cwd(),
    isPackaged: false,
  },
  net: {},
}));

import { ConnectionCheckError } from '../../src/core/providers/connection-check';
import { testProviderConnection } from '../../src/main/providers/provider-factory';
import type { ProviderProfile } from '../../src/main/storage/config-store';
import { describeUserFacingError } from '../../src/renderer/helpers/user-facing-error';
import type { Translate } from '../../src/renderer/i18n/runtime';

const translate = ((key: string) => key) as Translate;

const speechProfile = (
  providerId: ProviderProfile['providerId'],
  model: string,
): ProviderProfile => ({
  id: 'speech-1',
  kind: 'speech',
  providerId,
  secrets: { apiKey: 'sk-connection-secret' },
  values: {
    allowInsecurePrivateEndpoint: false,
    baseUrl: 'https://provider.example.test/v1',
    model,
    name: 'Speech',
    presetId: 'custom',
  },
});

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status,
  });

describe('speech connection checks', () => {
  it.each([
    ['deepseek-asr-speech', 'deepseek-asr', 'This is a connection test.'],
    ['deepseek-asr-speech', 'deepseek-asr', 'OKAY, this is a connection test!'],
    ['openai-compatible-speech', 'whisper-1', 'this is connection test'],
    ['aliyun-bailian-speech', 'qwen-audio-3.0-asr-flash', 'this is a connections test'],
  ] as const)('accepts %s transcript %j', async (providerId, model, text) => {
    const fetchImplementation = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        providerId === 'aliyun-bailian-speech'
          ? jsonResponse({ output: { text } })
          : jsonResponse({ text }),
      ),
    );

    await expect(
      testProviderConnection(speechProfile(providerId, model), fetchImplementation),
    ).resolves.toBeUndefined();
    expect(fetchImplementation).toHaveBeenCalledOnce();
    expect(fetchImplementation.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: 'Bearer sk-connection-secret',
    });
  });

  it('reports an empty transcript and a mismatch without repeating the transcript', async () => {
    const hidden = 'secret private words';
    const emptyFetch = vi.fn<typeof fetch>(() => Promise.resolve(jsonResponse({ text: '   ' })));
    const mismatchFetch = vi.fn<typeof fetch>(() =>
      Promise.resolve(jsonResponse({ text: hidden })),
    );
    const profile = speechProfile('deepseek-asr-speech', 'deepseek-asr');

    await expect(testProviderConnection(profile, emptyFetch)).rejects.toMatchObject({
      failure: 'empty',
    });
    await expect(testProviderConnection(profile, mismatchFetch)).rejects.toSatisfy(
      (error: unknown) => {
        expect(error).toBeInstanceOf(ConnectionCheckError);
        expect(error).toMatchObject({
          failure: 'mismatch',
          message: 'Connection check transcript did not match',
        });
        expect(String(error)).not.toContain(hidden);
        expect(describeUserFacingError(error, translate)).toBe('error.connectionCheckMismatch');
        return true;
      },
    );
    expect(
      describeUserFacingError(
        new ConnectionCheckError('empty', 'Connection check returned no transcript'),
        translate,
      ),
    ).toBe('error.connectionCheckEmpty');
  });

  it('preserves authentication and network errors', async () => {
    const profile = speechProfile('openai-compatible-speech', 'whisper-1');
    const authentication = vi.fn<typeof fetch>(() =>
      Promise.resolve(jsonResponse({ error: { message: 'Invalid API key' } }, 401)),
    );
    const network = vi.fn<typeof fetch>(() => Promise.reject(new TypeError('fetch failed')));

    await expect(testProviderConnection(profile, authentication)).rejects.toThrow(
      /status 401: Invalid API key/u,
    );
    await expect(testProviderConnection(profile, network)).rejects.toThrow('fetch failed');
    await expect(testProviderConnection(profile, authentication)).rejects.toSatisfy(
      (error: unknown) => {
        expect(String(error)).not.toContain('sk-connection-secret');
        expect(describeUserFacingError(error, translate)).toBe('error.serviceAuthentication');
        return true;
      },
    );
    await expect(testProviderConnection(profile, network)).rejects.toSatisfy((error: unknown) => {
      expect(describeUserFacingError(error, translate)).toBe('error.networkUnavailable');
      return true;
    });
  });

  it('cancels a check that is aborted before or during upload', async () => {
    const profile = speechProfile('deepseek-asr-speech', 'deepseek-asr');
    const alreadyAborted = new AbortController();
    alreadyAborted.abort();
    const unused = vi.fn<typeof fetch>();

    await expect(
      testProviderConnection(profile, unused, { signal: alreadyAborted.signal }),
    ).rejects.toMatchObject({ failure: 'cancelled' });
    expect(unused).not.toHaveBeenCalled();

    const duringUpload = new AbortController();
    const fetchImplementation = vi.fn<typeof fetch>((_input, init) => {
      duringUpload.abort();
      init?.signal?.throwIfAborted();
      return Promise.resolve(jsonResponse({ text: 'This is a connection test.' }));
    });
    await expect(
      testProviderConnection(profile, fetchImplementation, { signal: duringUpload.signal }),
    ).rejects.toMatchObject({
      failure: 'cancelled',
      message: 'Connection check was cancelled',
    });
    expect(describeUserFacingError(new Error('Connection check was cancelled'), translate)).toBe(
      'error.connectionCheckCancelled',
    );
  });

  it('keeps a provider timeout distinct from cancellation', async () => {
    const profile = speechProfile('openai-compatible-speech', 'whisper-1');
    const timeout = new Error('The operation was aborted due to timeout');
    timeout.name = 'TimeoutError';
    const fetchImplementation = vi.fn<typeof fetch>(() => Promise.reject(timeout));

    await expect(testProviderConnection(profile, fetchImplementation)).rejects.toBe(timeout);
    expect(describeUserFacingError(timeout, translate)).toBe('error.requestTimeout');
  });
});
