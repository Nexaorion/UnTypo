import { describe, expect, it } from 'vitest';
import {
  parseClipboardText,
  parseDictionaryTerm,
  parseHistoryQuery,
  parseProfile,
  parseProviderInput,
  parseSettingsUpdate,
} from '../../src/main/ipc/validation';
import {
  parseDiagnosticExportRequest,
  parseDiagnosticIssueIds,
  parseRendererIssue,
} from '../../src/main/ipc/diagnostic-validation';

describe('client IPC validation', () => {
  it('validates diagnostic export and renderer issue payloads', () => {
    const issueId = 'ec1e6ca3-dc50-412c-9aff-3eac670ff5de';
    expect(
      parseDiagnosticExportRequest({ includeAudio: true, issueIds: [issueId] }),
    ).toEqual({ includeAudio: true, issueIds: [issueId] });
    expect(
      parseRendererIssue({
        line: 42,
        message: 'Renderer failed',
        source: 'app://renderer/index.js',
      }),
    ).toMatchObject({ line: 42, message: 'Renderer failed' });
    expect(() => parseDiagnosticIssueIds(['not-an-issue-id'])).toThrow(
      'Invalid diagnostic issue ids',
    );
    expect(() =>
      parseRendererIssue({ message: 'Renderer failed', token: 'secret' }),
    ).toThrow('unsupported field');
  });

  it('accepts bounded settings and history requests', () => {
    expect(
      parseSettingsUpdate({
        diagnostics: {
          automaticCollection: false,
          showErrorDialogs: true,
        },
        dictation: {
          activeSpeechProviderProfileId: 'primary-speech',
          activeTextProviderProfileId: 'primary-text',
          hotkeyAccelerator: 'Ctrl+Shift+Space',
          microphoneDeviceId: 'microphone-1',
          microphoneDeviceLabel: 'USB Microphone',
        },
        general: { locale: 'en-US' },
        history: { enabled: false, retentionDays: 0 },
        updates: { autoCheck: false, autoDownload: true },
      }),
    ).toMatchObject({
      diagnostics: {
        automaticCollection: false,
        showErrorDialogs: true,
      },
      dictation: {
        activeSpeechProviderProfileId: 'primary-speech',
        activeTextProviderProfileId: 'primary-text',
        microphoneDeviceId: 'microphone-1',
        microphoneDeviceLabel: 'USB Microphone',
      },
      general: { locale: 'en-US' },
      history: { enabled: false, retentionDays: 0 },
      updates: { autoCheck: false, autoDownload: true },
    });
    expect(parseHistoryQuery({ limit: 50, offset: 10 })).toEqual({
      limit: 50,
      offset: 10,
    });
  });

  it('rejects unknown fields and unbounded values', () => {
    expect(() => parseSettingsUpdate({ admin: true })).toThrow(
      'unsupported field',
    );
    expect(() =>
      parseSettingsUpdate({
        dictation: { activeProviderProfileId: 'legacy-profile' },
      }),
    ).toThrow('unsupported field');
    expect(() => parseHistoryQuery({ limit: 501 })).toThrow(
      'Invalid history query',
    );
    expect(() => parseDictionaryTerm('x'.repeat(129))).toThrow(
      'Invalid dictionary term',
    );
    expect(() =>
      parseSettingsUpdate({
        dictation: { microphoneDeviceId: 'x'.repeat(513) },
      }),
    ).toThrow('Invalid microphone device');
    expect(() =>
      parseSettingsUpdate({
        dictation: { microphoneDeviceLabel: 'USB Microphone' },
      }),
    ).toThrow('requires a device id');
    expect(() => parseClipboardText('x'.repeat(1_000_001))).toThrow(
      'Invalid clipboard text',
    );
    expect(() =>
      parseSettingsUpdate({ updates: { autoCheck: 'yes' } }),
    ).toThrow('Invalid automatic update check setting');
    expect(() =>
      parseSettingsUpdate({
        diagnostics: { showErrorDialogs: 'yes' },
      }),
    ).toThrow('Invalid diagnostic dialog setting');
  });

  it('accepts text for the trusted clipboard bridge', () => {
    expect(parseClipboardText('Copied history record')).toBe(
      'Copied history record',
    );
  });

  it.each([
    ['text', 'openai-compatible-text', 'openai-text'],
    ['text', 'openai-responses-text', 'openai-text'],
    ['text', 'anthropic-text', 'anthropic-text'],
    ['speech', 'openai-compatible-speech', 'openai-speech'],
    ['speech', 'aliyun-bailian-speech', 'aliyun-bailian-speech'],
  ] as const)(
    'accepts the %s/%s provider shape',
    (kind, providerId, presetId) => {
      expect(
        parseProviderInput({
          id: `${kind}-${presetId}`,
          kind,
          providerId,
          secrets: { apiKey: 'secret' },
          values: {
            allowInsecurePrivateEndpoint: false,
            baseUrl: 'https://provider.example.test/v1',
            model: 'test-model',
            name: 'Test provider',
            presetId,
          },
        }),
      ).toMatchObject({ kind, providerId });
    },
  );

  it('enforces provider ids jointly with their kind', () => {
    expect(() =>
      parseProviderInput({
        id: 'mismatched-profile',
        kind: 'text',
        providerId: 'aliyun-bailian-speech',
        secrets: { apiKey: 'secret' },
        values: {
          baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
          model: 'qwen-audio-3.0-asr-flash',
          name: 'Aliyun Bailian',
          presetId: 'aliyun-bailian-speech',
        },
      }),
    ).toThrow('does not match');
  });

  it('normalizes an empty edit API key to omission', () => {
    expect(
      parseProviderInput({
        id: 'existing-text',
        kind: 'text',
        providerId: 'openai-compatible-text',
        secrets: { apiKey: '' },
        values: {
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o-mini',
          name: 'OpenAI',
          presetId: 'openai-text',
        },
      }).secrets,
    ).toEqual({});
  });

  it('rejects secret-like or unbounded provider values', () => {
    expect(() =>
      parseProviderInput({
        id: 'unsafe',
        kind: 'text',
        providerId: 'openai-compatible-text',
        secrets: { apiKey: 'secret' },
        values: {
          apiKey: 'plaintext-in-values',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o-mini',
          name: 'OpenAI',
          presetId: 'openai-text',
        },
      }),
    ).toThrow('unsupported field');
    expect(() =>
      parseProviderInput({
        id: 'too-long',
        kind: 'speech',
        providerId: 'openai-compatible-speech',
        secrets: { apiKey: 'secret' },
        values: {
          baseUrl: `https://example.test/${'x'.repeat(2_048)}`,
          model: 'whisper-1',
          name: 'OpenAI Speech',
          presetId: 'openai-speech',
        },
      }),
    ).toThrow('Invalid provider configuration');
  });

  it('bounds the encrypted personal profile fields', () => {
    expect(
      parseProfile({ preferredName: 'Alice', signature: 'Warm regards' }),
    ).toEqual({ preferredName: 'Alice', signature: 'Warm regards' });
    expect(() => parseProfile({ role: 'admin' })).toThrow('unsupported field');
  });
});
