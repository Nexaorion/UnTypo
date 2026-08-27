import { createHash } from 'node:crypto';
import {
  dictionaryTermKey,
  DICTIONARY_LIMITS,
  normalizeDictionaryTerm,
  type DictionaryCandidate,
} from '../../shared/dictionary.js';
import type {
  ConfigurationService,
  DictionaryLearningPrivateState,
  StoredDictionaryCandidate,
} from '../storage/configuration.js';

const CANDIDATE_RETENTION_MILLISECONDS = 30 * 24 * 60 * 60 * 1_000;
const REJECTION_COOLDOWN_MILLISECONDS = 30 * 24 * 60 * 60 * 1_000;
const MINIMUM_CONFIDENCE = 0.85;
const REMINDER_THRESHOLD = 0.99;
const MAX_OCCURRENCES = 100;
const RECENT_WINDOW_MILLISECONDS = 7 * 24 * 60 * 60 * 1_000;
const CATEGORY_PRIORITY: Readonly<
  Record<DictionaryCandidate['category'], number>
> = {
  organization: 0.035,
  person: 0.04,
  place: 0.025,
  product: 0.04,
  technical: 0,
};

const fingerprint = (term: string): string =>
  createHash('sha256').update(dictionaryTermKey(term)).digest('hex');

const currentCandidates = (
  candidates: readonly DictionaryCandidate[],
): readonly DictionaryCandidate[] => {
  const unique = new Map<string, DictionaryCandidate>();
  for (const candidate of candidates) {
    const term = normalizeDictionaryTerm(candidate.term);
    if (
      !term ||
      term.length > DICTIONARY_LIMITS.termLength ||
      !Number.isFinite(candidate.confidence) ||
      candidate.confidence < MINIMUM_CONFIDENCE ||
      candidate.confidence > 1
    ) {
      continue;
    }
    const normalized = { ...candidate, term };
    const key = dictionaryTermKey(term);
    const previous = unique.get(key);
    if (!previous || previous.confidence < normalized.confidence) {
      unique.set(key, normalized);
    }
  }
  return [...unique.values()].slice(0, 3);
};

const trimState = (
  state: DictionaryLearningPrivateState,
  now: number,
): DictionaryLearningPrivateState => ({
  candidates: state.candidates
    .filter(
      ({ lastSeenAt }) => lastSeenAt >= now - CANDIDATE_RETENTION_MILLISECONDS,
    )
    .toSorted((left, right) => right.lastSeenAt - left.lastSeenAt)
    .slice(0, DICTIONARY_LIMITS.candidates),
  rejections: state.rejections
    .filter(({ until }) => until > now)
    .toSorted((left, right) => right.until - left.until)
    .slice(0, DICTIONARY_LIMITS.candidates),
});

const reminderScore = (entry: StoredDictionaryCandidate): number => {
  const frequencyScore = Math.min(
    0.14,
    Math.log2(Math.max(1, entry.occurrences)) * 0.05,
  );
  const observationSpan = entry.lastSeenAt - entry.firstSeenAt;
  const recencyScore =
    entry.occurrences < 2
      ? 0
      : observationSpan <= RECENT_WINDOW_MILLISECONDS
        ? 0.02
        : observationSpan <= CANDIDATE_RETENTION_MILLISECONDS
          ? 0.01
          : 0;
  return (
    entry.candidate.confidence +
    CATEGORY_PRIORITY[entry.candidate.category] +
    frequencyScore +
    recencyScore
  );
};

export class DictionaryLearningService {
  readonly #configuration: ConfigurationService;
  readonly #now: () => number;

  constructor(
    configuration: ConfigurationService,
    now: () => number = Date.now,
  ) {
    this.#configuration = configuration;
    this.#now = now;
  }

  async observe(
    candidates: readonly DictionaryCandidate[],
  ): Promise<DictionaryCandidate | undefined> {
    const observed = currentCandidates(candidates);
    if (observed.length === 0) return undefined;
    const now = this.#now();
    const observedKeys = new Set(
      observed.map(({ term }) => dictionaryTermKey(term)),
    );
    const next = await this.#configuration.updateDictionaryLearningState(
      (stored, config) => {
        const state = trimState(stored, now);
        if (config.dictionary.length >= DICTIONARY_LIMITS.entries) {
          return { candidates: [], rejections: state.rejections };
        }
        const dictionaryKeys = new Set(
          config.dictionary.map(({ term }) => dictionaryTermKey(term)),
        );
        const rejectionFingerprints = new Set(
          state.rejections.map(({ fingerprint: value }) => value),
        );
        const byKey = new Map(
          state.candidates.map((entry) => [
            dictionaryTermKey(entry.candidate.term),
            entry,
          ]),
        );

        for (const candidate of observed) {
          const key = dictionaryTermKey(candidate.term);
          if (
            dictionaryKeys.has(key) ||
            rejectionFingerprints.has(fingerprint(candidate.term))
          ) {
            byKey.delete(key);
            continue;
          }
          const previous = byKey.get(key);
          const entry: StoredDictionaryCandidate = previous
            ? {
                candidate: {
                  ...candidate,
                  confidence: Math.max(
                    previous.candidate.confidence,
                    candidate.confidence,
                  ),
                },
                firstSeenAt: previous.firstSeenAt,
                lastSeenAt: now,
                occurrences: Math.min(
                  MAX_OCCURRENCES,
                  previous.occurrences + 1,
                ),
              }
            : {
                candidate,
                firstSeenAt: now,
                lastSeenAt: now,
                occurrences: 1,
              };
          byKey.set(key, entry);
        }

        return trimState(
          {
            candidates: [...byKey.values()],
            rejections: state.rejections,
          },
          now,
        );
      },
    );

    return next.candidates
      .filter(
        (entry) =>
          reminderScore(entry) >= REMINDER_THRESHOLD &&
          observedKeys.has(dictionaryTermKey(entry.candidate.term)),
      )
      .toSorted((left, right) => {
        const scoreDifference = reminderScore(right) - reminderScore(left);
        return (
          scoreDifference ||
          right.candidate.confidence - left.candidate.confidence ||
          left.firstSeenAt - right.firstSeenAt ||
          dictionaryTermKey(left.candidate.term).localeCompare(
            dictionaryTermKey(right.candidate.term),
          )
        );
      })[0]?.candidate;
  }

  async accept(originalTerm: string, acceptedTerm: string): Promise<void> {
    await this.#configuration.addDictionaryEntry(acceptedTerm, 'learned');
    await this.forgetTerms([originalTerm, acceptedTerm]);
  }

  async reject(term: string): Promise<void> {
    const now = this.#now();
    const key = dictionaryTermKey(term);
    const rejectedFingerprint = fingerprint(term);
    await this.#configuration.updateDictionaryLearningState((stored) => {
      const state = trimState(stored, now);
      return {
        candidates: state.candidates.filter(
          (entry) => dictionaryTermKey(entry.candidate.term) !== key,
        ),
        rejections: [
          ...state.rejections.filter(
            (entry) => entry.fingerprint !== rejectedFingerprint,
          ),
          {
            fingerprint: rejectedFingerprint,
            until: now + REJECTION_COOLDOWN_MILLISECONDS,
          },
        ].slice(-DICTIONARY_LIMITS.candidates),
      };
    });
  }

  async forgetTerm(term: string): Promise<void> {
    await this.forgetTerms([term]);
  }

  private async forgetTerms(terms: readonly string[]): Promise<void> {
    const keys = new Set(terms.map(dictionaryTermKey));
    const fingerprints = new Set(terms.map(fingerprint));
    await this.#configuration.updateDictionaryLearningState((stored) => ({
      candidates: stored.candidates.filter(
        (entry) => !keys.has(dictionaryTermKey(entry.candidate.term)),
      ),
      rejections: stored.rejections.filter(
        (entry) => !fingerprints.has(entry.fingerprint),
      ),
    }));
  }
}
