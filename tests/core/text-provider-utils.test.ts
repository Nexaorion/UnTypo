import { describe, expect, it } from 'vitest';
import {
  createTranscriptOutputTextStream,
  parseTranscriptProcessing,
  transcriptProcessingInstructions,
} from '../../src/core/providers/text-provider-utils';

const context = {
  defaultTargetLanguage: 'en-US' as const,
  dictionary: [],
  locale: 'en-US' as const,
};

describe('transcriptProcessingInstructions', () => {
  it('combines intent selection and final text generation in one response', () => {
    const instructions = transcriptProcessingInstructions(context);

    expect(instructions).toContain('single-pass transcript processor');
    expect(instructions).toContain(
      'Decide the intent and produce the final text',
    );
    expect(instructions).toContain('"outputText":"final text"');
    expect(instructions.indexOf('"outputText"')).toBeLessThan(
      instructions.indexOf('"intent"'),
    );
    expect(instructions).toContain('Start with outputText');
  });

  it('treats prompts for a target AI agent as structured transcription', () => {
    const instructions = transcriptProcessingInstructions({
      ...context,
      windowContext: {
        isTextEntry: true,
        processId: 42,
        windowHandle: '0x1234',
      },
    });

    expect(instructions).toContain(
      'including a prompt for an AI assistant or coding agent, is transcription',
    );
    expect(instructions).toContain('edit it into a direct, concise prompt');
    expect(instructions).toContain(
      'instead of answering or performing the request',
    );
    expect(instructions).toContain(
      'goal, context, requirements, constraints, and acceptance criteria',
    );
  });

  it('uses the detected AI application as prompt-generation context', () => {
    const instructions = transcriptProcessingInstructions({
      ...context,
      windowContext: {
        application: { kind: 'ai-tool', name: 'Codex' },
        isTextEntry: true,
        processId: 42,
        windowHandle: '0x1234',
      },
    });

    expect(instructions).toContain('target application is "Codex"');
    expect(instructions).toContain(
      'speaker is dictating a prompt for that target',
    );
    expect(instructions).toContain(
      'Never choose instruction, answer, or perform the target task',
    );
  });

  it('auto-formats dictated structure without inventing a template', () => {
    const instructions = transcriptProcessingInstructions(context);

    expect(instructions).toContain(
      'format it as concise Markdown bullets or numbered steps',
    );
    expect(instructions).toContain(
      'Markdown may appear only inside outputText when useful',
    );
    expect(instructions).toContain('never invent missing details');
    expect(instructions).toContain(
      'Do not force headings, lists, or a template',
    );
  });

  it('can force the one-pass processor to return plain transcription', () => {
    expect(
      transcriptProcessingInstructions({
        ...context,
        forcedIntent: 'transcription',
      }),
    ).toContain('intent is forced to "transcription"');
  });

  it('requests dictionary candidates only when automatic learning is enabled', () => {
    const instructions = transcriptProcessingInstructions({
      ...context,
      dictionaryLearningEnabled: true,
    });

    expect(instructions).toContain('up to 3 high-confidence proper terms');
    expect(instructions).toContain('dictionaryCandidates');
  });
});

describe('createTranscriptOutputTextStream', () => {
  it('emits decoded output text before trailing metadata is complete', () => {
    const updates: string[] = [];
    const stream = createTranscriptOutputTextStream((outputText) =>
      updates.push(outputText),
    );

    stream.push('{"outputText":"Hello');
    stream.push('\\nUnTypo","intent":"trans');
    stream.push('cription","dictionaryCandidates":[]}');

    expect(updates).toEqual(['Hello', 'Hello\nUnTypo']);
  });

  it('finishes with the validated output when streaming is unavailable', () => {
    const updates: string[] = [];
    const stream = createTranscriptOutputTextStream((outputText) =>
      updates.push(outputText),
    );

    stream.complete('Final text');

    expect(updates).toEqual(['Final text']);
  });
});

describe('parseTranscriptProcessing', () => {
  it('extracts the intent and final text from a JSON response', () => {
    expect(
      parseTranscriptProcessing(
        '```json\n{"intent":"translation","outputText":"Hello"}\n```',
      ),
    ).toEqual({ intent: 'translation', outputText: 'Hello' });
  });

  it('rejects a classification without final text', () => {
    expect(() => parseTranscriptProcessing('{"intent":"translation"}')).toThrow(
      'invalid transcript result',
    );
  });

  it('keeps valid high-confidence candidates and ignores malformed entries', () => {
    expect(
      parseTranscriptProcessing(
        JSON.stringify({
          dictionaryCandidates: [
            {
              category: 'product',
              confidence: 0.96,
              term: '  UnTypo  ',
            },
            { category: 'person', confidence: 0.5, term: 'Alice' },
            { category: 'other', confidence: 0.99, term: 'noise' },
          ],
          intent: 'transcription',
          outputText: 'Use UnTypo',
        }),
      ),
    ).toEqual({
      dictionaryCandidates: [
        { category: 'product', confidence: 0.96, term: 'UnTypo' },
      ],
      intent: 'transcription',
      outputText: 'Use UnTypo',
    });
  });

  it('does not fail transcript processing when candidates are malformed', () => {
    expect(
      parseTranscriptProcessing(
        '{"intent":"transcription","outputText":"Hello","dictionaryCandidates":"ignore me"}',
      ),
    ).toEqual({
      dictionaryCandidates: [],
      intent: 'transcription',
      outputText: 'Hello',
    });
  });
});
