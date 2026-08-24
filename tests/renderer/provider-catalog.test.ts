import { describe, expect, it } from 'vitest';
import {
  createProviderProfileId,
  getProviderPreset,
  getProviderPresets,
  PROVIDER_PRESETS,
  resolveProviderPreset,
  TEXT_ENDPOINT_TYPES,
} from '../../src/renderer/logic/provider-catalog';
import { PROFILE_ID_PATTERN } from '../../src/renderer/logic/provider-form';

describe('provider preset catalog', () => {
  it('offers independent text and speech provider choices', () => {
    expect(getProviderPresets('text').map((preset) => preset.id)).toEqual([
      'openai-text',
      'anthropic-text',
      'deepseek-text',
      'openrouter-text',
      'custom-text',
    ]);
    expect(getProviderPresets('speech').map((preset) => preset.id)).toEqual([
      'openai-speech',
      'groq-speech',
      'aliyun-bailian-speech',
      'custom-openai-speech',
    ]);
  });

  it('keeps every preset id valid as an auto-generated profile id', () => {
    for (const preset of PROVIDER_PRESETS) {
      expect(PROFILE_ID_PATTERN.test(preset.id)).toBe(true);
    }
  });

  it('presets provider names and endpoints without choosing model ids', () => {
    expect(getProviderPreset('openai-text')).toMatchObject({
      baseUrl: 'https://api.openai.com/v1',
      providerId: 'openai-responses-text',
    });
    expect(getProviderPreset('anthropic-text')).toMatchObject({
      baseUrl: 'https://api.anthropic.com/v1',
      providerId: 'anthropic-text',
    });
    expect(getProviderPreset('deepseek-text')).toMatchObject({
      baseUrl: 'https://api.deepseek.com',
    });
    expect(getProviderPreset('aliyun-bailian-speech')).toMatchObject({
      baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
      providerId: 'aliyun-bailian-speech',
    });
    for (const preset of PROVIDER_PRESETS) {
      expect(preset).not.toHaveProperty('model');
    }
  });

  it('offers one custom text provider with three endpoint protocols', () => {
    expect(getProviderPreset('custom-text')).toMatchObject({
      baseUrl: '',
      name: 'Custom provider',
      providerId: 'openai-responses-text',
    });
    expect(TEXT_ENDPOINT_TYPES.map(({ providerId }) => providerId)).toEqual([
      'openai-responses-text',
      'openai-compatible-text',
      'anthropic-text',
    ]);
  });

  it('allocates deterministic collision-free profile ids', () => {
    expect(
      createProviderProfileId(
        'openai-text',
        new Set(['openai-text', 'openai-text-2']),
      ),
    ).toBe('openai-text-3');
  });

  it('falls back to the matching custom preset for unknown endpoints', () => {
    expect(
      resolveProviderPreset({
        baseUrl: 'https://gateway.example/v1',
        kind: 'text',
        presetId: 'legacy',
        providerId: 'anthropic-text',
      }).id,
    ).toBe('custom-text');
    expect(
      resolveProviderPreset({
        baseUrl: 'https://gateway.example/v1',
        kind: 'speech',
        presetId: 'legacy',
        providerId: 'openai-compatible-speech',
      }).id,
    ).toBe('custom-openai-speech');
  });
});
