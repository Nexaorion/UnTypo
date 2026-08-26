import { describe, expect, it } from 'vitest';
import { intentInstructions } from '../../src/core/providers/text-provider-utils';

const context = {
  defaultTargetLanguage: 'en-US' as const,
  dictionary: [],
  locale: 'en-US' as const,
};

describe('intentInstructions', () => {
  it('keeps instruction generation available outside a text-entry target', () => {
    expect(
      intentInstructions({
        ...context,
        windowContext: {
          isTextEntry: false,
          processId: 42,
          windowHandle: '0x1234',
        },
      }),
    ).toContain('Classify as instruction only when explicitly requesting');
  });

  it('prefers exact transcription for a confirmed text-entry target', () => {
    expect(
      intentInstructions({
        ...context,
        windowContext: {
          isTextEntry: true,
          processId: 42,
          windowHandle: '0x1234',
        },
      }),
    ).toContain('ALWAYS classify as "transcription"');
  });
});
