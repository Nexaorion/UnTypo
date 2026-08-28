import { describe, expect, it, vi } from 'vitest';
import { OpenAICompatibleTextProvider } from '../../src/core/providers/openai-compatible-text-provider';

const configuration = {
  apiKey: 'sk-openai-test',
  baseUrl: 'https://gateway.example.com/v1/',
  displayName: 'Gateway Text',
  id: 'gateway-text',
  model: 'chat-model',
};

const eventStreamResponse = (events: readonly unknown[]): Response =>
  new Response(
    `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')}data: [DONE]\n\n`,
    { headers: { 'Content-Type': 'text/event-stream' }, status: 200 },
  );

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
                    intent: 'translation',
                    outputText: 'Hello',
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
      provider.processTranscript('翻译成英文：你好', {
        defaultTargetLanguage: 'zh-CN',
        dictionary: [],
        locale: 'zh-CN',
      }),
    ).resolves.toEqual({
      intent: 'translation',
      outputText: 'Hello',
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
      messages: [
        { role: 'system' },
        { content: '翻译成英文：你好', role: 'user' },
      ],
      model: 'chat-model',
    });
    expect(body).not.toHaveProperty('max_tokens');
    expect(body).not.toHaveProperty('temperature');
    expect(body).toMatchObject({ stream: true });
  });

  it('streams Chat Completions deltas into outputText updates', async () => {
    const provider = new OpenAICompatibleTextProvider(
      configuration,
      vi.fn(() =>
        Promise.resolve(
          eventStreamResponse([
            { choices: [{ delta: { content: '{"outputText":"Hel' } }] },
            {
              choices: [
                { delta: { content: 'lo","intent":"transcription"}' } },
              ],
            },
          ]),
        ),
      ),
    );
    const updates: string[] = [];

    await expect(
      provider.processTranscript('hello', {
        defaultTargetLanguage: 'en-US',
        dictionary: [],
        locale: 'en-US',
        onOutputTextUpdate: (outputText) => updates.push(outputText),
      }),
    ).resolves.toEqual({ intent: 'transcription', outputText: 'Hello' });
    expect(updates).toEqual(['Hel', 'Hello']);
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
      provider.processTranscript('text', {
        defaultTargetLanguage: 'en-US',
        dictionary: [],
        locale: 'en-US',
      }),
    ).rejects.toThrow('Bad key');
  });
});
