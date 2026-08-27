import { describe, expect, it, vi } from 'vitest';
import { AnthropicTextProvider } from '../../src/core/providers/anthropic-text-provider';

const configuration = {
  apiKey: 'sk-ant-test',
  baseUrl: 'https://api.anthropic.com/v1',
  displayName: 'Anthropic',
  id: 'anthropic-text',
  model: 'claude-test',
};

describe('AnthropicTextProvider', () => {
  it('uses Messages with Anthropic authentication headers', async () => {
    const request = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            content: [
              {
                text: JSON.stringify({
                  intent: 'translation',
                  outputText: '你好',
                }),
                type: 'text',
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );
    const provider = new AnthropicTextProvider(configuration, request);

    await expect(
      provider.processTranscript('translate hello', {
        defaultTargetLanguage: 'zh-CN',
        dictionary: [],
        locale: 'en-US',
      }),
    ).resolves.toEqual({ intent: 'translation', outputText: '你好' });

    const [url, init] = request.mock.calls[0] ?? [];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init?.headers).toMatchObject({
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
      'x-api-key': 'sk-ant-test',
    });
    if (typeof init?.body !== 'string') throw new Error('Expected JSON body');
    const body = JSON.parse(init.body) as Record<string, unknown>;
    expect(body).toMatchObject({
      max_tokens: 2_048,
      messages: [{ content: 'translate hello', role: 'user' }],
      model: 'claude-test',
    });
    expect(body).not.toHaveProperty('temperature');
  });

  it('surfaces a provider error message', async () => {
    const provider = new AnthropicTextProvider(
      configuration,
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: { message: 'Quota spent' } }), {
            status: 429,
          }),
        ),
      ),
    );

    await expect(
      provider.processTranscript('text', {
        defaultTargetLanguage: 'en-US',
        dictionary: [],
        locale: 'en-US',
      }),
    ).rejects.toThrow('Quota spent');
  });
});
