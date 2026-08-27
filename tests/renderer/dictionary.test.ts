import { describe, expect, it } from 'vitest';
import {
  addDictionaryEntry,
  DICTIONARY_LIMITS,
  removeDictionaryEntry,
} from '../../src/renderer/logic/dictionary';

describe('addDictionaryEntry', () => {
  it('appends a trimmed term', () => {
    expect(
      addDictionaryEntry(
        [{ source: 'manual', term: 'UnTypo' }],
        '  Electron  ',
      ),
    ).toEqual({
      entry: { source: 'manual', term: 'Electron' },
      ok: true,
    });
  });

  it('rejects blank input', () => {
    expect(addDictionaryEntry([], '   ')).toEqual({
      ok: false,
      reason: 'empty',
    });
  });

  it('rejects case-insensitive duplicates', () => {
    expect(
      addDictionaryEntry([{ source: 'manual', term: 'UnTypo' }], 'untypo'),
    ).toEqual({
      ok: false,
      reason: 'duplicate',
    });
  });

  it('rejects terms past the stored length limit', () => {
    const term = 'a'.repeat(DICTIONARY_LIMITS.termLength + 1);
    expect(addDictionaryEntry([], term)).toEqual({
      ok: false,
      reason: 'tooLong',
    });
  });

  it('rejects additions past the stored entry limit', () => {
    const entries = Array.from(
      { length: DICTIONARY_LIMITS.entries },
      (_value, index) => ({
        source: 'manual' as const,
        term: `term-${index}`,
      }),
    );
    expect(addDictionaryEntry(entries, 'one-more')).toEqual({
      ok: false,
      reason: 'full',
    });
  });
});

describe('removeDictionaryEntry', () => {
  it('removes only the exact term', () => {
    expect(
      removeDictionaryEntry(
        [
          { source: 'manual', term: 'a' },
          { source: 'learned', term: 'b' },
          { source: 'manual', term: 'A' },
        ],
        'a',
      ),
    ).toEqual([
      { source: 'learned', term: 'b' },
      { source: 'manual', term: 'A' },
    ]);
  });
});
