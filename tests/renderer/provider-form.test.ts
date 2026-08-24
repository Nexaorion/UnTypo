import { describe, expect, it } from 'vitest';
import { getProviderPreset } from '../../src/renderer/logic/provider-catalog';
import {
  emptyProviderForm,
  selectProviderPreset,
  selectTextEndpointType,
  toProviderInput,
  validateBaseUrlInput,
  validateProviderForm,
  type ProviderFormState,
} from '../../src/renderer/logic/provider-form';

const validForm = (): ProviderFormState => ({
  ...emptyProviderForm('text'),
  apiKey: 'sk-test',
  model: 'test-model',
});

describe('validateProviderForm', () => {
  it('accepts a complete text profile', () => {
    expect(validateProviderForm(validForm())).toEqual({});
  });

  it('requires an id, name, model, endpoint, and new API key', () => {
    const errors = validateProviderForm({
      ...validForm(),
      apiKey: '   ',
      baseUrl: '',
      id: '',
      model: '',
      name: '',
    });

    expect(errors).toEqual({
      apiKey: 'required',
      baseUrl: 'required',
      id: 'required',
      model: 'required',
      name: 'required',
    });
  });

  it('allows a blank API key while editing a configured profile', () => {
    expect(
      validateProviderForm({
        ...validForm(),
        apiKey: '',
        hasStoredApiKey: true,
      }).apiKey,
    ).toBeUndefined();
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
      model: 'm'.repeat(201),
    });
    expect(errors.model).toBe('tooLong');
  });

  it('rejects a preset that does not match the adapter', () => {
    const errors = validateProviderForm({
      ...validForm(),
      providerId: 'anthropic-text',
    });
    expect(errors.presetId).toBe('invalidPreset');
  });
});

describe('validateBaseUrlInput', () => {
  it('requires an endpoint', () => {
    expect(validateBaseUrlInput('', false)).toBe('required');
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

describe('selectProviderPreset', () => {
  it('switches protocol defaults and allocates a matching profile id', () => {
    const anthropic = getProviderPreset('anthropic-text');
    expect(anthropic).toBeDefined();
    if (!anthropic) return;

    const selected = selectProviderPreset(
      validForm(),
      anthropic,
      new Set(['anthropic-text']),
      false,
    );
    expect(selected).toMatchObject({
      baseUrl: 'https://api.anthropic.com/v1',
      id: 'anthropic-text-2',
      model: '',
      presetId: 'anthropic-text',
      providerId: 'anthropic-text',
    });
  });

  it('preserves the profile id when editing', () => {
    const deepSeek = getProviderPreset('deepseek-text');
    expect(deepSeek).toBeDefined();
    if (!deepSeek) return;

    const selected = selectProviderPreset(
      { ...validForm(), id: 'my-profile' },
      deepSeek,
      new Set(['my-profile']),
      true,
    );
    expect(selected.id).toBe('my-profile');
  });

  it('requires a provider-specific API key after switching presets', () => {
    const anthropic = getProviderPreset('anthropic-text');
    expect(anthropic).toBeDefined();
    if (!anthropic) return;

    const selected = selectProviderPreset(
      {
        ...validForm(),
        apiKey: '',
        hasStoredApiKey: true,
        id: 'existing-openai',
      },
      anthropic,
      new Set(['existing-openai']),
      true,
    );

    expect(selected).toMatchObject({
      apiKey: '',
      hasStoredApiKey: false,
      id: 'existing-openai',
    });
    expect(validateProviderForm(selected).apiKey).toBe('required');
  });
});

describe('selectTextEndpointType', () => {
  it('switches the custom text protocol and requires its own API key', () => {
    const custom = getProviderPreset('custom-text');
    expect(custom).toBeDefined();
    if (!custom) return;
    const form = selectProviderPreset(validForm(), custom, new Set(), false);

    const selected = selectTextEndpointType(
      { ...form, hasStoredApiKey: true },
      'anthropic-text',
    );

    expect(selected).toMatchObject({
      apiKey: '',
      hasStoredApiKey: false,
      presetId: 'custom-text',
      providerId: 'anthropic-text',
    });
    expect(validateProviderForm(selected).apiKey).toBe('required');
  });
});

describe('toProviderInput', () => {
  it('trims values and serializes the selected adapter', () => {
    const input = toProviderInput({
      ...validForm(),
      apiKey: ' sk-test ',
      baseUrl: ' https://api.openai.com/v1 ',
      id: ' openai-text ',
      model: ' gpt-5-mini ',
      name: ' Main OpenAI ',
    });

    expect(input).toEqual({
      id: 'openai-text',
      kind: 'text',
      providerId: 'openai-responses-text',
      secrets: { apiKey: 'sk-test' },
      values: {
        allowInsecurePrivateEndpoint: false,
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-5-mini',
        name: 'Main OpenAI',
        presetId: 'openai-text',
      },
    });
  });

  it('omits an unchanged stored API key', () => {
    const input = toProviderInput({
      ...validForm(),
      apiKey: '',
      hasStoredApiKey: true,
    });
    expect(input.secrets).toEqual({});
  });
});
