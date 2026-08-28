import { createHash } from 'node:crypto';
import {
  PERSONALIZATION_LIMITS,
  normalizeWritingPreferenceCandidate,
  type ClientPersonalizationMemorySnapshot,
  type LearnedWritingPreference,
  type TargetApplicationKind,
  type WritingPreferenceCandidate,
} from '../../shared/personalization.js';
import type {
  PersonalizationPrivateState,
  StoredWritingPreferenceCandidate,
} from '../storage/configuration.js';
import type { ConfigurationService } from '../storage/configuration.js';

const DAY_MS = 24 * 60 * 60 * 1_000;
const CANDIDATE_RETENTION_MS = 30 * DAY_MS;
const REJECTION_COOLDOWN_MS = 30 * DAY_MS;

const preferenceKey = (
  application: TargetApplicationKind,
  candidate: Pick<WritingPreferenceCandidate, 'kind' | 'value'>,
): string => `${application}\u0000${candidate.kind}\u0000${candidate.value}`;

const preferenceId = (
  application: TargetApplicationKind,
  candidate: Pick<WritingPreferenceCandidate, 'kind' | 'value'>,
): string =>
  createHash('sha256')
    .update(preferenceKey(application, candidate))
    .digest('hex')
    .slice(0, 24);

const candidateScore = (
  stored: StoredWritingPreferenceCandidate,
  now: number,
): number => {
  const frequency = Math.min(
    Math.log2(stored.occurrences + 1) / Math.log2(6),
    1,
  );
  const age = Math.max(0, now - stored.lastSeenAt);
  const recency = Math.max(0, 1 - age / CANDIDATE_RETENTION_MS);
  const categoryWeight = stored.candidate.kind === 'expression' ? 0 : 0.04;
  return (
    stored.candidate.confidence * 0.55 +
    frequency * 0.3 +
    recency * 0.1 +
    categoryWeight
  );
};

const readyCandidates = (
  state: PersonalizationPrivateState,
  now: number,
): readonly StoredWritingPreferenceCandidate[] =>
  state.candidates
    .filter((candidate) => candidateScore(candidate, now) >= 0.8)
    .toSorted(
      (left, right) =>
        candidateScore(right, now) - candidateScore(left, now) ||
        right.lastSeenAt - left.lastSeenAt,
    )
    .slice(0, 3);

export class WritingPreferenceLearningService {
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
    candidates: readonly WritingPreferenceCandidate[],
    application: TargetApplicationKind,
  ): Promise<boolean> {
    const now = this.#now();
    let changed = false;
    const unique = new Map<string, WritingPreferenceCandidate>();
    for (const source of candidates.slice(
      0,
      PERSONALIZATION_LIMITS.modelCandidates,
    )) {
      const candidate = normalizeWritingPreferenceCandidate(source);
      if (!candidate) continue;
      unique.set(preferenceKey(application, candidate), candidate);
    }
    await this.#configuration.updatePersonalizationState((state, config) => {
      if (!config.personalization.learningEnabled || unique.size === 0) {
        return state;
      }
      const rejections = state.rejections.filter(({ until }) => until > now);
      const rejected = new Set(
        rejections.map(({ fingerprint }) => fingerprint),
      );
      const preferences = state.preferences;
      const accepted = new Set(preferences.map(({ id }) => id));
      const storedCandidates = state.candidates.filter(
        ({ application: scope, candidate, lastSeenAt }) =>
          now - lastSeenAt <= CANDIDATE_RETENTION_MS &&
          !accepted.has(preferenceId(scope, candidate)) &&
          !rejected.has(preferenceId(scope, candidate)),
      );
      if (
        rejections.length !== state.rejections.length ||
        storedCandidates.length !== state.candidates.length
      ) {
        changed = true;
      }
      const byKey = new Map(
        storedCandidates.map((stored) => [
          preferenceKey(stored.application, stored.candidate),
          stored,
        ]),
      );
      for (const [key, candidate] of unique) {
        const id = preferenceId(application, candidate);
        if (accepted.has(id) || rejected.has(id)) continue;
        const previous = byKey.get(key);
        byKey.set(
          key,
          previous
            ? {
                ...previous,
                candidate: {
                  ...candidate,
                  confidence: Math.max(
                    previous.candidate.confidence,
                    candidate.confidence,
                  ),
                },
                lastSeenAt: now,
                occurrences: previous.occurrences + 1,
              }
            : {
                application,
                candidate,
                firstSeenAt: now,
                lastSeenAt: now,
                occurrences: 1,
              },
        );
        changed = true;
      }
      const nextCandidates = [...byKey.values()]
        .toSorted((left, right) => right.lastSeenAt - left.lastSeenAt)
        .slice(0, PERSONALIZATION_LIMITS.candidates);
      return { candidates: nextCandidates, preferences, rejections };
    });
    return changed;
  }

  async snapshot(): Promise<ClientPersonalizationMemorySnapshot> {
    const state = await this.#configuration.getPersonalizationState();
    const now = this.#now();
    return {
      preferences: state.preferences.toSorted(
        (left, right) => right.confirmedAt - left.confirmedAt,
      ),
      suggestions: readyCandidates(state, now).map(
        ({ application, candidate, occurrences }) => ({
          application,
          id: preferenceId(application, candidate),
          kind: candidate.kind,
          occurrences,
          value: candidate.value,
        }),
      ),
    };
  }

  async getPreferences(): Promise<readonly LearnedWritingPreference[]> {
    return (await this.#configuration.getPersonalizationState()).preferences;
  }

  async accept(id: string): Promise<void> {
    const now = this.#now();
    await this.#configuration.updatePersonalizationState((state) => {
      const candidate = readyCandidates(state, now).find(
        (stored) => preferenceId(stored.application, stored.candidate) === id,
      );
      if (!candidate) throw new Error('Personalization suggestion is stale');
      const preference: LearnedWritingPreference = {
        application: candidate.application,
        confirmedAt: now,
        id,
        kind: candidate.candidate.kind,
        value: candidate.candidate.value,
      };
      const preferences = [
        preference,
        ...state.preferences.filter((entry) => entry.id !== id),
      ].slice(0, PERSONALIZATION_LIMITS.preferences);
      return {
        candidates: state.candidates.filter(
          (stored) => preferenceId(stored.application, stored.candidate) !== id,
        ),
        preferences,
        rejections: state.rejections.filter(
          ({ fingerprint }) => fingerprint !== id,
        ),
      };
    });
  }

  async reject(id: string): Promise<void> {
    const now = this.#now();
    await this.#configuration.updatePersonalizationState((state) => {
      const candidate = readyCandidates(state, now).find(
        (stored) => preferenceId(stored.application, stored.candidate) === id,
      );
      if (!candidate) throw new Error('Personalization suggestion is stale');
      const rejections = [
        ...state.rejections.filter(({ fingerprint }) => fingerprint !== id),
        { fingerprint: id, until: now + REJECTION_COOLDOWN_MS },
      ]
        .toSorted((left, right) => right.until - left.until)
        .slice(0, PERSONALIZATION_LIMITS.candidates);
      return {
        candidates: state.candidates.filter(
          (stored) => preferenceId(stored.application, stored.candidate) !== id,
        ),
        preferences: state.preferences,
        rejections,
      };
    });
  }

  async remove(id: string): Promise<void> {
    await this.#configuration.updatePersonalizationState((state) => ({
      ...state,
      preferences: state.preferences.filter((entry) => entry.id !== id),
    }));
  }

  async clear(): Promise<void> {
    await this.#configuration.clearPersonalizationMemory();
  }
}
