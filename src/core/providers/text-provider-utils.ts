import {
  ProviderContractError,
  type ProviderCapabilities,
  type SupportedLanguage,
  type TextProcessContext,
  type TextProcessResult,
} from './contracts.js';
import {
  DICTIONARY_CANDIDATE_CATEGORIES,
  DICTIONARY_LIMITS,
  normalizeDictionaryTerm,
  type DictionaryCandidate,
} from '../../shared/dictionary.js';

export const textProviderCapabilities: Readonly<ProviderCapabilities> = {
  speechToText: false,
  textPolish: true,
  toneAdaptation: true,
  translation: true,
  instructionGeneration: true,
  intentDetection: true,
  streamingPartial: true,
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
- "transcription": turn dictated speech into ready-to-use writing while preserving the speaker's meaning and original language.
- "translation": use only when the speaker explicitly asks the dictation system to translate the dictated content.
- "instruction": use only when the speaker explicitly asks the dictation system itself to create or transform content.`;
  const application = context.windowContext?.application;
  const targetContext =
    application?.kind === 'ai-tool'
      ? `The target application is ${JSON.stringify(application.name ?? 'an AI tool')}. It is an AI assistant or coding agent, so the speaker is dictating a prompt for that target. Always treat task requests as transcription and edit them into prompts. Never choose instruction, answer, or perform the target task in this application context.`
      : context.windowContext?.isTextEntry
        ? `The target is an editable field in another application. Content addressed to that application, including a prompt for an AI assistant or coding agent, is transcription even when it uses imperative language. Choose instruction only when the speaker explicitly addresses UnTypo, the dictation system, or the transcription tool and asks it to perform the request.`
        : `When the target is not an editable field, still choose instruction only for an explicit request that the dictation system itself should perform.`;
  const profile = context.profile
    ? ` User profile context, to use only when directly relevant: ${JSON.stringify(context.profile)}.`
    : '';
  const dictionaryLearning = context.dictionaryLearningEnabled
    ? `\nAlso identify up to 3 high-confidence proper terms explicitly used by the speaker. Eligible categories are person names, place names, organizations, products, acronyms, and specialized technical terms. Exclude common words, generic phrases, and anything inferred only from generated output. Use the most likely canonical spelling. Each candidate must include a confidence from 0 to 1 and one category from "person", "place", "organization", "product", or "technical".`
    : '';
  const responseShape = context.dictionaryLearningEnabled
    ? '{"outputText":"final text","intent":"transcription|translation|instruction","dictionaryCandidates":[{"term":"canonical term","category":"person|place|organization|product|technical","confidence":0.95}]}'
    : '{"outputText":"final text","intent":"transcription|translation|instruction"}';

  return `You are UnTypo's single-pass transcript processor. Decide the intent and produce the final text in this one response.

${intentInstruction}

${targetContext}

Apply the selected intent:
- For transcription, return polished, ready-to-use writing rather than a verbatim transcript.${context.tone ? ` Use a ${context.tone} tone.` : ''}
  - Remove filler words, hesitation, false starts, accidental repetition, and superseded wording when the speaker corrects themself.
  - Preserve the final intended meaning, original language, names, code identifiers, numbers, examples, requirements, and constraints. Correct only obvious recognition errors and never invent missing details.
  - Infer punctuation and paragraph breaks. When the speaker clearly dictates a list, sequence, requirements, or acceptance criteria, format it as concise Markdown bullets or numbered steps.
  - When the dictated content is a request for an AI assistant or coding agent, edit it into a direct, concise prompt instead of answering or performing the request. Lead with the requested action, remove conversational wrappers such as "I want the agent to", and group only the supplied goal, context, requirements, constraints, and acceptance criteria under short sections when that materially improves scanability.
  - Keep short requests short. Do not force headings, lists, or a template when a clear sentence is enough.
- For translation, omit the spoken translation command and translate the requested content. An explicitly spoken target language wins; otherwise use ${languageName(targetLanguage)}.
- For instruction, omit the spoken command wrapper and return only the completed content. Use the speaker's language (${languageName(context.locale)}) unless they explicitly request another language.
${terms ? `Preserve these terms exactly when applicable: ${terms}.` : ''}${profile}${dictionaryLearning}

Return only one JSON object in this exact property order: ${responseShape}. Start with outputText so its value can be shown while the response is still streaming. Add intent and dictionaryCandidates only after outputText. Markdown may appear only inside outputText when useful. Do not wrap the JSON in a Markdown code fence or add commentary outside it.`;
};

const decodeOutputTextPrefix = (source: string): string | undefined => {
  const keyIndex = source.indexOf('"outputText"');
  if (keyIndex < 0) return undefined;
  const colonIndex = source.indexOf(':', keyIndex + 12);
  if (colonIndex < 0) return undefined;

  let index = colonIndex + 1;
  while (/\s/u.test(source[index] ?? '')) index += 1;
  if (source[index] !== '"') return undefined;
  index += 1;

  let output = '';
  while (index < source.length) {
    const character = source[index];
    if (character === '"') return output;
    if (character !== '\\') {
      output += character;
      index += 1;
      continue;
    }

    const escape = source[index + 1];
    if (!escape) return output;
    const escapedCharacters: Readonly<Record<string, string>> = {
      '"': '"',
      '\\': '\\',
      '/': '/',
      b: '\b',
      f: '\f',
      n: '\n',
      r: '\r',
      t: '\t',
    };
    if (escape === 'u') {
      const code = source.slice(index + 2, index + 6);
      if (code.length < 4 || !/^[0-9a-f]{4}$/iu.test(code)) return output;
      output += String.fromCharCode(Number.parseInt(code, 16));
      index += 6;
      continue;
    }
    const decoded = escapedCharacters[escape];
    if (decoded === undefined) return output;
    output += decoded;
    index += 2;
  }
  return output;
};

export interface TranscriptOutputTextStream {
  complete: (outputText: string) => void;
  push: (delta: string) => void;
}

export const createTranscriptOutputTextStream = (
  listener?: (outputText: string) => void,
): TranscriptOutputTextStream => {
  let source = '';
  let lastOutput = '';
  const emit = (outputText: string): void => {
    if (!listener || !outputText || outputText === lastOutput) return;
    lastOutput = outputText;
    try {
      listener(outputText);
    } catch {
      // Presentation failures must not invalidate an otherwise usable result.
    }
  };

  return {
    complete: emit,
    push: (delta) => {
      source += delta;
      const outputText = decodeOutputTextPrefix(source);
      if (outputText !== undefined) emit(outputText);
    },
  };
};

const parseDictionaryCandidates = (
  value: unknown,
): readonly DictionaryCandidate[] => {
  if (!Array.isArray(value)) return [];
  const candidates: DictionaryCandidate[] = [];
  const entries: readonly unknown[] = value;
  for (const entry of entries.slice(0, 3)) {
    if (
      typeof entry !== 'object' ||
      entry === null ||
      !('term' in entry) ||
      !('category' in entry) ||
      !('confidence' in entry)
    ) {
      continue;
    }
    const record: Record<string, unknown> = entry;
    if (
      typeof record.term !== 'string' ||
      !DICTIONARY_CANDIDATE_CATEGORIES.includes(record.category as never) ||
      typeof record.confidence !== 'number' ||
      !Number.isFinite(record.confidence) ||
      record.confidence < 0.85 ||
      record.confidence > 1
    ) {
      continue;
    }
    const term = normalizeDictionaryTerm(record.term);
    if (!term || term.length > DICTIONARY_LIMITS.termLength) continue;
    candidates.push({
      category: record.category as DictionaryCandidate['category'],
      confidence: record.confidence,
      term,
    });
  }
  return candidates;
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
    ...('dictionaryCandidates' in value
      ? {
          dictionaryCandidates: parseDictionaryCandidates(
            value.dictionaryCandidates,
          ),
        }
      : {}),
    intent: value.intent,
    outputText: value.outputText.trim(),
  };
};
