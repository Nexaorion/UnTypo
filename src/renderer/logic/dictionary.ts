export const DICTIONARY_LIMITS = {
  entries: 1_000,
  termLength: 128,
} as const;

export type DictionaryAddResult =
  | { entries: readonly string[]; ok: true }
  | { ok: false; reason: 'duplicate' | 'empty' | 'full' | 'tooLong' };

export const addDictionaryEntry = (
  entries: readonly string[],
  term: string,
): DictionaryAddResult => {
  const trimmed = term.trim();
  if (trimmed.length === 0) return { ok: false, reason: 'empty' };
  if (trimmed.length > DICTIONARY_LIMITS.termLength) {
    return { ok: false, reason: 'tooLong' };
  }
  if (entries.some((entry) => entry.toLowerCase() === trimmed.toLowerCase())) {
    return { ok: false, reason: 'duplicate' };
  }
  if (entries.length >= DICTIONARY_LIMITS.entries) {
    return { ok: false, reason: 'full' };
  }
  return { entries: [...entries, trimmed], ok: true };
};

export const removeDictionaryEntry = (
  entries: readonly string[],
  term: string,
): readonly string[] => entries.filter((entry) => entry !== term);
