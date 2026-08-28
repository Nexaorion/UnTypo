import { describe, expect, it, vi } from 'vitest';
import { OpenAIResponsesTextProvider } from '../../src/core/providers/openai-responses-text-provider';

const configuration = {
  apiKey: 'sk-openai-test',
  baseUrl: 'https://gateway.example.com/v1/',
  displayName: 'Responses Gateway',
  id: 'responses-gateway',
  model: 'response-model',
};

const eventStreamResponse = (events: readonly unknown[]): Response =>
  new Response(
    `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')}data: [DONE]\n\n`,
    { headers: { 'Content-Type': 'text/event-stream' }, status: 200 },
  );

describe('OpenAIResponsesTextProvider', () => {
  it('uses the Responses endpoint and extracts output content', async () => {
    const request = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            output: [
              {
                content: [
                  {
                    text: JSON.stringify({
                      intent: 'translation',
                      outputText: 'Hello',
                    }),
                    type: 'output_text',
                  },
                ],
                type: 'message',
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );
    const provider = new OpenAIResponsesTextProvider(configuration, request);

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
    expect(url).toBe('https://gateway.example.com/v1/responses');
    expect(init?.headers).toMatchObject({
      Authorization: 'Bearer sk-openai-test',
      'Content-Type': 'application/json',
    });
    if (typeof init?.body !== 'string') throw new Error('Expected JSON body');
    expect(JSON.parse(init.body)).toMatchObject({
      input: '翻译成英文：你好',
      model: 'response-model',
      store: false,
      stream: true,
    });
  });

  it('streams outputText before the final Responses JSON is complete', async () => {
    const provider = new OpenAIResponsesTextProvider(
      configuration,
      vi.fn(() =>
        Promise.resolve(
          eventStreamResponse([
            {
              delta: '{"outputText":"Hel',
              type: 'response.output_text.delta',
            },
            {
              delta: 'lo","intent":"translation"}',
              type: 'response.output_text.delta',
            },
          ]),
        ),
      ),
    );
    const updates: string[] = [];

    await expect(
      provider.processTranscript('翻译：你好', {
        defaultTargetLanguage: 'en-US',
        dictionary: [],
        locale: 'zh-CN',
        onOutputTextUpdate: (outputText) => updates.push(outputText),
      }),
    ).resolves.toEqual({ intent: 'translation', outputText: 'Hello' });
    expect(updates).toEqual(['Hel', 'Hello']);
  });

  it('accepts an output_text convenience field', async () => {
    const provider = new OpenAIResponsesTextProvider(
      configuration,
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              output_text: JSON.stringify({
                intent: 'transcription',
                outputText: 'polished text',
              }),
            }),
            { status: 200 },
          ),
        ),
      ),
    );

    await expect(
      provider.processTranscript('text', {
        defaultTargetLanguage: 'en-US',
        dictionary: [],
        locale: 'en-US',
      }),
    ).resolves.toEqual({
      intent: 'transcription',
      outputText: 'polished text',
    });
  });

  it('surfaces a provider error message', async () => {
    const provider = new OpenAIResponsesTextProvider(
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
