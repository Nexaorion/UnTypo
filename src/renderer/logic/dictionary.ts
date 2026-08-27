import {
  dictionaryTermKey,
  DICTIONARY_LIMITS,
  normalizeDictionaryTerm,
  type DictionaryEntry,
} from '../../shared/dictionary.js';

export { DICTIONARY_LIMITS } from '../../shared/dictionary.js';

export type DictionaryAddResult =
  | { entry: DictionaryEntry; ok: true }
  | { ok: false; reason: 'duplicate' | 'empty' | 'full' | 'tooLong' };

export const addDictionaryEntry = (
  entries: readonly DictionaryEntry[],
  term: string,
): DictionaryAddResult => {
  const trimmed = normalizeDictionaryTerm(term);
  if (trimmed.length === 0) return { ok: false, reason: 'empty' };
  if (trimmed.length > DICTIONARY_LIMITS.termLength) {
    return { ok: false, reason: 'tooLong' };
  }
  if (
    entries.some(
      (entry) => dictionaryTermKey(entry.term) === dictionaryTermKey(trimmed),
    )
  ) {
    return { ok: false, reason: 'duplicate' };
  }
  if (entries.length >= DICTIONARY_LIMITS.entries) {
    return { ok: false, reason: 'full' };
  }
  return { entry: { source: 'manual', term: trimmed }, ok: true };
};

export const removeDictionaryEntry = (
  entries: readonly DictionaryEntry[],
  term: string,
): readonly DictionaryEntry[] => entries.filter((entry) => entry.term !== term);
