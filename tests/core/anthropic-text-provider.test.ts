import { describe, expect, it, vi } from 'vitest';
import { AnthropicTextProvider } from '../../src/core/providers/anthropic-text-provider';

const configuration = {
  apiKey: 'sk-ant-test',
  baseUrl: 'https://api.anthropic.com/v1',
  displayName: 'Anthropic',
  id: 'anthropic-text',
  model: 'claude-test',
};

const eventStreamResponse = (events: readonly unknown[]): Response =>
  new Response(
    events
      .map(
        (event) =>
          `event: ${(event as { type?: string }).type ?? 'message'}\ndata: ${JSON.stringify(event)}\n\n`,
      )
      .join(''),
    { headers: { 'Content-Type': 'text/event-stream' }, status: 200 },
  );

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
    expect(body).toMatchObject({ stream: true });
  });

  it('streams Anthropic text deltas into outputText updates', async () => {
    const provider = new AnthropicTextProvider(
      configuration,
      vi.fn(() =>
        Promise.resolve(
          eventStreamResponse([
            {
              delta: { text: '{"outputText":"Hel', type: 'text_delta' },
              index: 0,
              type: 'content_block_delta',
            },
            {
              delta: {
                text: 'lo","intent":"transcription"}',
                type: 'text_delta',
              },
              index: 0,
              type: 'content_block_delta',
            },
            { type: 'message_stop' },
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

  it('disables default thinking for Claude 5 models', async () => {
    const request = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            content: [
              {
                text: JSON.stringify({
                  intent: 'transcription',
                  outputText: 'Hello',
                }),
                type: 'text',
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );
    const provider = new AnthropicTextProvider(
      { ...configuration, model: 'claude-sonnet-5' },
      request,
    );

    await provider.processTranscript('hello', {
      defaultTargetLanguage: 'en-US',
      dictionary: [],
      locale: 'en-US',
    });

    const [, init] = request.mock.calls[0] ?? [];
    if (typeof init?.body !== 'string') throw new Error('Expected JSON body');
    expect(JSON.parse(init.body)).toMatchObject({
      thinking: { type: 'disabled' },
    });
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
