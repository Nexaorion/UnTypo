import { describe, expect, it } from 'vitest';
import {
  emptyProviderForm,
  toProviderInput,
  validateBaseUrlInput,
  validateProviderForm,
  type ProviderFormState,
} from '../../src/renderer/logic/provider-form';

const validForm = (): ProviderFormState => ({
  ...emptyProviderForm(),
  apiKey: 'sk-test',
  id: 'openai-main',
});

describe('validateProviderForm', () => {
  it('accepts a complete profile', () => {
    expect(validateProviderForm(validForm())).toEqual({});
  });

  it('requires an id, models and api key', () => {
    const errors = validateProviderForm({
      allowInsecurePrivateEndpoint: false,
      apiKey: '   ',
      baseUrl: '',
      id: '',
      textModel: '',
      transcriptionModel: '',
    });

    expect(errors).toEqual({
      apiKey: 'required',
      id: 'required',
      textModel: 'required',
      transcriptionModel: 'required',
    });
  });

  it('rejects ids the backend pattern would reject', () => {
    for (const id of [
      'Upper',
      '-leading',
      'has space',
      '.dot',
      'a'.repeat(65),
    ]) {
      expect(validateProviderForm({ ...validForm(), id }).id).toBe('invalidId');
    }
  });

  it('accepts ids the backend pattern allows', () => {
    for (const id of ['a', '0', 'openai.main-2_x', 'a'.repeat(64)]) {
      expect(validateProviderForm({ ...validForm(), id }).id).toBeUndefined();
    }
  });

  it('flags models beyond the backend length limit', () => {
    const errors = validateProviderForm({
      ...validForm(),
      textModel: 'm'.repeat(201),
    });
    expect(errors.textModel).toBe('tooLong');
  });
});

describe('validateBaseUrlInput', () => {
  it('treats a blank value as the provider default', () => {
    expect(validateBaseUrlInput('', false)).toBeUndefined();
  });

  it('accepts https endpoints', () => {
    expect(
      validateBaseUrlInput('https://api.openai.com/v1', false),
    ).toBeUndefined();
  });

  it('rejects unparsable values', () => {
    expect(validateBaseUrlInput('api.openai.com', false)).toBe('invalidUrl');
  });

  it('rejects http endpoints unless private access is enabled', () => {
    expect(validateBaseUrlInput('http://localhost:11434/v1', false)).toBe(
      'insecureUrl',
    );
    expect(
      validateBaseUrlInput('http://localhost:11434/v1', true),
    ).toBeUndefined();
    expect(validateBaseUrlInput('http://example.com/v1', true)).toBe(
      'insecureUrl',
    );
  });
});

describe('toProviderInput', () => {
  it('trims values and omits an empty base url', () => {
    const input = toProviderInput({
      allowInsecurePrivateEndpoint: false,
      apiKey: ' sk-test ',
      baseUrl: '   ',
      id: ' openai-main ',
      textModel: ' gpt-4o-mini ',
      transcriptionModel: ' whisper-1 ',
    });

    expect(input).toEqual({
      id: 'openai-main',
      providerId: 'openai',
      secrets: { apiKey: 'sk-test' },
      values: {
        allowInsecurePrivateEndpoint: false,
        textModel: 'gpt-4o-mini',
        transcriptionModel: 'whisper-1',
      },
    });
  });

  it('keeps a provided base url', () => {
    const input = toProviderInput({
      ...validForm(),
      baseUrl: 'https://proxy.example.com/v1',
    });
    expect(input.values.baseUrl).toBe('https://proxy.example.com/v1');
  });
});
