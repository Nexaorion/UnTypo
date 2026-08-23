import { describe, expect, it } from 'vitest';
import {
  parseDictionary,
  parseHistoryQuery,
  parseProfile,
  parseProviderInput,
  parseSettingsUpdate,
} from '../../src/main/ipc/validation';

describe('client IPC validation', () => {
  it('accepts bounded settings and history requests', () => {
    expect(
      parseSettingsUpdate({
        dictation: {
          activeProviderProfileId: 'primary-openai',
          hotkeyAccelerator: 'Ctrl+Shift+Space',
          hotkeyMode: 'toggle',
        },
        general: { locale: 'en-US' },
        history: { enabled: false, retentionDays: 0 },
      }),
    ).toMatchObject({
      dictation: { activeProviderProfileId: 'primary-openai' },
      general: { locale: 'en-US' },
      history: { enabled: false, retentionDays: 0 },
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
    expect(() => parseHistoryQuery({ limit: 501 })).toThrow(
      'Invalid history query',
    );
    expect(() => parseDictionary(['x'.repeat(129)])).toThrow(
      'Invalid dictionary',
    );
  });

  it('accepts only the supported BYOK provider shape', () => {
    expect(
      parseProviderInput({
        id: 'primary-openai',
        providerId: 'openai',
        secrets: { apiKey: 'sk-secret' },
        values: {
          baseUrl: 'https://api.openai.com/v1',
          textModel: 'gpt-test',
          transcriptionModel: 'gpt-transcribe-test',
        },
      }),
    ).toMatchObject({ id: 'primary-openai', providerId: 'openai' });
    expect(() =>
      parseProviderInput({
        id: 'unsafe',
        providerId: 'openai',
        secrets: { apiKey: 'sk-secret' },
        values: {
          apiKey: 'plaintext-in-values',
          textModel: 'gpt-test',
          transcriptionModel: 'gpt-transcribe-test',
        },
      }),
    ).toThrow('unsupported field');
  });

  it('bounds the encrypted personal profile fields', () => {
    expect(
      parseProfile({ preferredName: 'Alice', signature: 'Warm regards' }),
    ).toEqual({ preferredName: 'Alice', signature: 'Warm regards' });
    expect(() => parseProfile({ role: 'admin' })).toThrow('unsupported field');
  });
});
