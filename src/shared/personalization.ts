export const TARGET_APPLICATION_KINDS = [
  'ai-tool',
  'browser',
  'chat-app',
  'general',
  'ide',
  'office',
] as const;

export type TargetApplicationKind = (typeof TARGET_APPLICATION_KINDS)[number];

export interface TargetApplicationContext {
  kind: TargetApplicationKind;
  name?: string;
}

export const WRITING_STYLE_PRESETS = [
  'auto',
  'casual',
  'formal',
  'concise',
  'prompt',
] as const;

export type WritingStylePreset = (typeof WRITING_STYLE_PRESETS)[number];

export type ApplicationWritingStyles = Readonly<
  Record<TargetApplicationKind, WritingStylePreset>
>;

export const DEFAULT_APPLICATION_WRITING_STYLES: ApplicationWritingStyles = {
  'ai-tool': 'prompt',
  browser: 'auto',
  'chat-app': 'casual',
  general: 'auto',
  ide: 'concise',
  office: 'formal',
};

export interface ClientApplicationWritingStyleUpdate {
  application: TargetApplicationKind;
  style: WritingStylePreset;
}

export const WRITING_PREFERENCE_KINDS = [
  'emoji',
  'expression',
  'punctuation',
  'structure',
  'tone',
  'verbosity',
] as const;

export type WritingPreferenceKind = (typeof WRITING_PREFERENCE_KINDS)[number];

export interface WritingPreferenceCandidate {
  confidence: number;
  kind: WritingPreferenceKind;
  value: string;
}

export interface LearnedWritingPreference {
  application: TargetApplicationKind;
  confirmedAt: number;
  id: string;
  kind: WritingPreferenceKind;
  value: string;
}

export interface ClientWritingPreferenceSuggestion {
  application: TargetApplicationKind;
  id: string;
  kind: WritingPreferenceKind;
  occurrences: number;
  value: string;
}

export interface ClientPersonalizationMemorySnapshot {
  preferences: readonly LearnedWritingPreference[];
  suggestions: readonly ClientWritingPreferenceSuggestion[];
}

export const PERSONALIZATION_LIMITS = {
  candidateValueLength: 40,
  candidates: 100,
  modelCandidates: 2,
  preferences: 50,
} as const;

const preferenceValues: Readonly<
  Record<Exclude<WritingPreferenceKind, 'expression'>, readonly string[]>
> = {
  emoji: ['allow', 'avoid'],
  punctuation: ['minimal', 'standard'],
  structure: ['lists', 'paragraphs'],
  tone: ['casual', 'formal', 'polite'],
  verbosity: ['concise', 'detailed'],
};

const privateExpressionPattern =
  /(?:https?:\/\/|\bapi[_-]?key\b|\bsk-[a-z0-9]|@|[a-f0-9]{32,})/iu;

export const normalizeWritingPreferenceCandidate = (
  value: unknown,
): WritingPreferenceCandidate | undefined => {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('confidence' in value) ||
    typeof value.confidence !== 'number' ||
    !Number.isFinite(value.confidence) ||
    value.confidence < 0 ||
    value.confidence > 1 ||
    !('kind' in value) ||
    !WRITING_PREFERENCE_KINDS.some((kind) => kind === value.kind) ||
    !('value' in value) ||
    typeof value.value !== 'string'
  ) {
    return undefined;
  }
  const normalized = value.value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  if (
    !normalized ||
    normalized.length > PERSONALIZATION_LIMITS.candidateValueLength
  ) {
    return undefined;
  }
  const kind = WRITING_PREFERENCE_KINDS.find(
    (candidate) => candidate === value.kind,
  );
  if (!kind) return undefined;
  if (kind === 'expression') {
    if (privateExpressionPattern.test(normalized)) return undefined;
  } else if (!preferenceValues[kind].includes(normalized)) {
    return undefined;
  }
  return { confidence: value.confidence, kind, value: normalized };
};
