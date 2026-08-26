import { describe, expect, it } from 'vitest';
import {
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
  });

  it('keeps dictated requests as transcription in an editable target', () => {
    expect(
      transcriptProcessingInstructions({
        ...context,
        windowContext: {
          isTextEntry: true,
          processId: 42,
          windowHandle: '0x1234',
        },
      }),
    ).toContain('normally text being dictated into that application');
  });

  it('can force the one-pass processor to return plain transcription', () => {
    expect(
      transcriptProcessingInstructions({
        ...context,
        forcedIntent: 'transcription',
      }),
    ).toContain('intent is forced to "transcription"');
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
});
