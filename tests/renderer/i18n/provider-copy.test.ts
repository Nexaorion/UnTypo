import { describe, expect, it } from 'vitest';

import { messages } from '../../../src/renderer/i18n/messages';

describe('new provider copy', () => {
  it('keeps the DeepSeek ASR hint to one short sentence in each locale', () => {
    expect(messages['zh-CN']['provider.deepseekAsrHint']).toBe(
      '使用 DeepSeek ASR 官方接口，填写 API Key 后即可使用。',
    );
    expect(messages['en-US']['provider.deepseekAsrHint']).toBe(
      'Uses the official DeepSeek ASR API. Enter an API key to start.',
    );
  });

  it('keeps connection-check feedback short and distinct', () => {
    expect(messages['zh-CN']['error.connectionCheckCancelled']).toBe('连接检查已取消');
    expect(messages['zh-CN']['error.connectionCheckEmpty']).toBe('已连上，但没识别到文字');
    expect(messages['zh-CN']['error.connectionCheckMismatch']).toBe('已连上，但识别结果不对');
    expect(messages['en-US']['error.connectionCheckCancelled']).toBe('Connection check cancelled.');
    expect(messages['en-US']['error.connectionCheckEmpty']).toBe(
      'Connected, but nothing was recognized.',
    );
    expect(messages['en-US']['error.connectionCheckMismatch']).toBe(
      "Connected, but the result doesn't match.",
    );
  });
});
