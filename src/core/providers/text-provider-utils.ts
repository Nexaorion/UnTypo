import {
  ProviderContractError,
  type ProviderCapabilities,
  type SupportedLanguage,
  type TextProcessContext,
  type TextProcessResult,
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

const languageName = (language: SupportedLanguage): string =>
  language === 'zh-CN' ? 'Simplified Chinese (zh-CN)' : 'English (en-US)';

export const transcriptProcessingInstructions = (
  context: TextProcessContext,
): string => {
  const terms = context.dictionary.join(', ');
  const targetLanguage =
    context.explicitTargetLanguage ?? context.defaultTargetLanguage;
  const intentInstruction = context.forcedIntent
    ? `The intent is forced to "${context.forcedIntent}". Do not choose another intent.`
    : `Choose exactly one intent:
- "transcription": clean up dictated text while preserving the speaker's meaning and original language.
- "translation": use only when the speaker explicitly asks the dictation system to translate the dictated content.
- "instruction": use only when the speaker explicitly asks the dictation system itself to create or transform content.`;
  const targetContext = context.windowContext?.isTextEntry
    ? `The target is an editable field in another application. Spoken requests such as "help me write an email" are normally text being dictated into that application, so treat them as transcription unless the speaker explicitly addresses UnTypo, the dictation system, or the transcription tool and asks it to perform the request.`
    : `When the target is not an editable field, still choose instruction only for an explicit request that the dictation system itself should perform.`;
  const profile = context.profile
    ? ` User profile context, to use only when directly relevant: ${JSON.stringify(context.profile)}.`
    : '';

  return `You are UnTypo's single-pass transcript processor. Decide the intent and produce the final text in this one response.

${intentInstruction}

${targetContext}

Apply the selected intent:
- For transcription, remove filler words and accidental repetition, correct obvious recognition errors, and preserve meaning and formatting.${context.tone ? ` Use a ${context.tone} tone.` : ''}
- For translation, omit the spoken translation command and translate the requested content. An explicitly spoken target language wins; otherwise use ${languageName(targetLanguage)}.
- For instruction, omit the spoken command wrapper and return only the completed content. Use the speaker's language (${languageName(context.locale)}) unless they explicitly request another language.
${terms ? `Preserve these terms exactly when applicable: ${terms}.` : ''}${profile}

Return only one JSON object with exactly these keys: {"intent":"transcription|translation|instruction","outputText":"final text"}. Do not add Markdown or commentary.`;
};

export const parseTranscriptProcessing = (
  source: string,
): TextProcessResult => {
  const firstBrace = source.indexOf('{');
  const lastBrace = source.lastIndexOf('}');
  if (firstBrace < 0 || lastBrace < firstBrace) {
    throw new ProviderContractError(
      'INVALID_PROVIDER',
      'Text provider returned an invalid transcript result',
    );
  }

  let value: unknown;
  try {
    value = JSON.parse(source.slice(firstBrace, lastBrace + 1)) as unknown;
  } catch {
    throw new ProviderContractError(
      'INVALID_PROVIDER',
      'Text provider returned an invalid transcript result',
    );
  }

  if (
    typeof value !== 'object' ||
    value === null ||
    !('intent' in value) ||
    (value.intent !== 'transcription' &&
      value.intent !== 'translation' &&
      value.intent !== 'instruction') ||
    !('outputText' in value) ||
    typeof value.outputText !== 'string' ||
    !value.outputText.trim()
  ) {
    throw new ProviderContractError(
      'INVALID_PROVIDER',
      'Text provider returned an invalid transcript result',
    );
  }

  return {
    intent: value.intent,
    outputText: value.outputText.trim(),
  };
};
