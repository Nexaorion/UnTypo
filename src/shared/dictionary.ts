export const DICTIONARY_LIMITS = {
  candidates: 100,
  entries: 1_000,
  termLength: 128,
} as const;

export type DictionaryEntrySource = 'learned' | 'manual';

export interface DictionaryEntry {
  source: DictionaryEntrySource;
  term: string;
}

export type DictionaryCandidateCategory =
  'organization' | 'person' | 'place' | 'product' | 'technical';

export interface DictionaryCandidate {
  category: DictionaryCandidateCategory;
  confidence: number;
  term: string;
}

export const DICTIONARY_CANDIDATE_CATEGORIES: readonly DictionaryCandidateCategory[] =
  ['organization', 'person', 'place', 'product', 'technical'];

export const normalizeDictionaryTerm = (term: string): string =>
  term.normalize('NFKC').trim().replace(/\s+/gu, ' ');

export const dictionaryTermKey = (term: string): string =>
  normalizeDictionaryTerm(term).toLowerCase();
