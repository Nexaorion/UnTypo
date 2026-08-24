import {
  ProviderContractError,
  type IntentClassificationResult,
  type IntentContext,
  type ProviderCapabilities,
  type SupportedLanguage,
} from './contracts.js';

export const textProviderCapabilities: Readonly<ProviderCapabilities> = {
  speechToText: false,
  textPolish: true,
  toneAdaptation: true,
  translation: true,
  instructionGeneration: true,
  intentDetection: true,
  streamingPartial: false,
};

export const intentInstructions = (context: IntentContext): string =>
  `Classify the user's spoken text as transcription, translation, or instruction. Detect an explicitly spoken translation target if it is Simplified Chinese or English. The configured fallback target is ${context.defaultTargetLanguage}. Return only JSON with keys intent and explicitTargetLanguage. intent must be transcription, translation, or instruction. explicitTargetLanguage must be zh-CN, en-US, or null.`;

export const parseIntentClassification = (
  source: string,
): IntentClassificationResult => {
  const firstBrace = source.indexOf('{');
  const lastBrace = source.lastIndexOf('}');
  if (firstBrace < 0 || lastBrace < firstBrace) {
    throw new ProviderContractError(
      'INVALID_PROVIDER',
      'Text provider returned an invalid intent classification',
    );
  }

  let value: unknown;
  try {
    value = JSON.parse(source.slice(firstBrace, lastBrace + 1)) as unknown;
  } catch {
    throw new ProviderContractError(
      'INVALID_PROVIDER',
      'Text provider returned an invalid intent classification',
    );
  }
  if (
    typeof value !== 'object' ||
    value === null ||
    !('intent' in value) ||
    (value.intent !== 'transcription' &&
      value.intent !== 'translation' &&
      value.intent !== 'instruction')
  ) {
    throw new ProviderContractError(
      'INVALID_PROVIDER',
      'Text provider returned an invalid intent classification',
    );
  }

  const explicitTargetLanguage =
    'explicitTargetLanguage' in value &&
    (value.explicitTargetLanguage === 'zh-CN' ||
      value.explicitTargetLanguage === 'en-US')
      ? value.explicitTargetLanguage
      : undefined;
  return {
    intent: value.intent,
    ...(explicitTargetLanguage ? { explicitTargetLanguage } : {}),
  };
};

export const translationInstructions = (
  targetLanguage: SupportedLanguage,
): string =>
  `Translate the input into ${targetLanguage}. Return only the translation while preserving meaning, formatting, and proper nouns.`;

export const generationInstructions = (
  locale: SupportedLanguage,
  dictionary: readonly string[],
): string => {
  const terms = dictionary.join(', ');
  return `Follow the spoken instruction and generate the requested content in ${locale}. Return only the finished content.${terms ? ` Preserve these terms exactly: ${terms}.` : ''}`;
};

export const polishInstructions = (
  locale: SupportedLanguage,
  dictionary: readonly string[],
  tone?: string,
): string => {
  const terms = dictionary.join(', ');
  return `Polish this transcript in ${locale}. Remove filler words and repetition, correct errors, and preserve the speaker's meaning and formatting.${tone ? ` Use a ${tone} tone.` : ''}${terms ? ` Preserve these terms exactly: ${terms}.` : ''} Return only the polished text.`;
};
