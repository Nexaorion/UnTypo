import { describe, expect, it, vi } from 'vitest';
import { OpenAICompatibleTextProvider } from '../../src/core/providers/openai-compatible-text-provider';

const configuration = {
  apiKey: 'sk-openai-test',
  baseUrl: 'https://gateway.example.com/v1/',
  displayName: 'Gateway Text',
  id: 'gateway-text',
  model: 'chat-model',
};

describe('OpenAICompatibleTextProvider', () => {
  it('uses Chat Completions with bearer authentication', async () => {
    const request = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    explicitTargetLanguage: 'en-US',
                    intent: 'translation',
                  }),
                },
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );
    const provider = new OpenAICompatibleTextProvider(configuration, request);

    await expect(
      provider.classifyIntent('翻译成英文', {
        defaultTargetLanguage: 'zh-CN',
        dictionary: [],
        locale: 'zh-CN',
      }),
    ).resolves.toEqual({
      explicitTargetLanguage: 'en-US',
      intent: 'translation',
    });

    const [url, init] = request.mock.calls[0] ?? [];
    expect(url).toBe('https://gateway.example.com/v1/chat/completions');
    expect(init?.headers).toMatchObject({
      Authorization: 'Bearer sk-openai-test',
      'Content-Type': 'application/json',
    });
    if (typeof init?.body !== 'string') throw new Error('Expected JSON body');
    const body = JSON.parse(init.body) as Record<string, unknown>;
    expect(body).toMatchObject({
      messages: [{ role: 'system' }, { content: '翻译成英文', role: 'user' }],
      model: 'chat-model',
    });
    expect(body).not.toHaveProperty('max_tokens');
    expect(body).not.toHaveProperty('temperature');
  });

  it('surfaces a provider error message', async () => {
    const provider = new OpenAICompatibleTextProvider(
      configuration,
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: { message: 'Bad key' } }), {
            status: 401,
          }),
        ),
      ),
    );

    await expect(
      provider.polish('text', { dictionary: [], locale: 'en-US' }),
    ).rejects.toThrow('Bad key');
  });
});
