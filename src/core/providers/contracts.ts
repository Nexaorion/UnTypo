export const PROVIDER_CONTRACT_VERSION = '1.0' as const;

export type ProviderContractVersion = typeof PROVIDER_CONTRACT_VERSION;
export type DictationIntent = 'transcription' | 'translation' | 'instruction';
export type ProviderKind = 'builtin' | 'community' | 'official-cloud' | 'local';
export type SupportedLanguage = 'zh-CN' | 'en-US';

export interface AudioPayload {
  bytes: Uint8Array;
  channels: number;
  durationMs: number;
  mimeType: string;
  sampleRateHz: number;
}

export interface ProviderCapabilities {
  speechToText: boolean;
  textPolish: boolean;
  toneAdaptation: boolean;
  translation: boolean;
  instructionGeneration: boolean;
  intentDetection: boolean;
  streamingPartial: boolean;
}

export interface ProviderUsage {
  audioDurationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
}

export interface TranscriptResult {
  language?: string;
  text: string;
  usage?: ProviderUsage;
}

export interface UserProfileContext {
  displayName?: string;
  preferredName?: string;
  signature?: string;
}

export interface TranscribeOptions {
  dictionary: readonly string[];
  language: SupportedLanguage;
  signal?: AbortSignal;
}

export interface IntentContext {
  defaultTargetLanguage: SupportedLanguage;
  dictionary: readonly string[];
  locale: SupportedLanguage;
  signal?: AbortSignal;
}

export interface TranslationContext {
  signal?: AbortSignal;
  targetLanguage: SupportedLanguage;
}

export interface GenerationContext {
  dictionary: readonly string[];
  locale: SupportedLanguage;
  profile?: UserProfileContext;
  signal?: AbortSignal;
}

export interface PolishContext {
  dictionary: readonly string[];
  locale: SupportedLanguage;
  signal?: AbortSignal;
  tone?: string;
}

export interface ProcessOptions {
  defaultTargetLanguage: SupportedLanguage;
  dictionary: readonly string[];
  explicitTargetLanguage?: SupportedLanguage;
  language: SupportedLanguage;
  preferIntegratedProcess?: boolean;
  profile?: UserProfileContext;
  signal?: AbortSignal;
  tone?: string;
}

export interface ProcessResult {
  intent: DictationIntent;
  outputText: string;
  rawTranscript?: string;
  usage?: ProviderUsage;
}

export interface DictationProvider {
  capabilities: Readonly<ProviderCapabilities>;
  configSchema: Readonly<Record<string, unknown>>;
  contractVersion: ProviderContractVersion;
  displayName: string;
  id: string;
  kind: ProviderKind;
  classifyIntent?: (
    text: string,
    context: IntentContext,
  ) => Promise<DictationIntent>;
  generateFromInstruction?: (
    instructionText: string,
    context: GenerationContext,
  ) => Promise<string>;
  polish?: (text: string, context: PolishContext) => Promise<string>;
  process?: (
    audio: AudioPayload,
    options: ProcessOptions,
  ) => Promise<ProcessResult>;
  transcribe: (
    audio: AudioPayload,
    options: TranscribeOptions,
  ) => Promise<TranscriptResult>;
  translate?: (text: string, context: TranslationContext) => Promise<string>;
}

export type ProviderContractErrorCode =
  | 'ABORTED'
  | 'DUPLICATE_PROVIDER'
  | 'EMPTY_RESULT'
  | 'INVALID_OPTIONS'
  | 'INVALID_PROVIDER'
  | 'UNSUPPORTED_CAPABILITY';

export class ProviderContractError extends Error {
  readonly code: ProviderContractErrorCode;

  constructor(code: ProviderContractErrorCode, message: string) {
    super(message);
    this.name = 'ProviderContractError';
    this.code = code;
  }
}

const providerIdPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/;

const capabilityMethods = [
  ['intentDetection', 'classifyIntent'],
  ['instructionGeneration', 'generateFromInstruction'],
  ['textPolish', 'polish'],
  ['translation', 'translate'],
] as const;

export const assertProviderContract = (provider: DictationProvider): void => {
  if (provider.contractVersion !== PROVIDER_CONTRACT_VERSION) {
    throw new ProviderContractError(
      'INVALID_PROVIDER',
      `Provider ${provider.id} uses an unsupported contract version`,
    );
  }

  if (!providerIdPattern.test(provider.id)) {
    throw new ProviderContractError(
      'INVALID_PROVIDER',
      `Provider id ${provider.id} is invalid`,
    );
  }

  if (!provider.displayName.trim()) {
    throw new ProviderContractError(
      'INVALID_PROVIDER',
      `Provider ${provider.id} must have a display name`,
    );
  }

  if (!provider.capabilities.speechToText) {
    throw new ProviderContractError(
      'INVALID_PROVIDER',
      `Provider ${provider.id} must support speech-to-text`,
    );
  }

  for (const [capability, method] of capabilityMethods) {
    if (provider.capabilities[capability] && !provider[method]) {
      throw new ProviderContractError(
        'INVALID_PROVIDER',
        `Provider ${provider.id} declares ${capability} without ${method}`,
      );
    }
  }
};

export const assertProcessResult = (result: ProcessResult): void => {
  if (!result.outputText.trim()) {
    throw new ProviderContractError(
      'EMPTY_RESULT',
      'Provider returned an empty output',
    );
  }

  if (
    result.intent !== 'transcription' &&
    result.intent !== 'translation' &&
    result.intent !== 'instruction'
  ) {
    throw new ProviderContractError(
      'INVALID_PROVIDER',
      'Provider returned an invalid intent',
    );
  }
};
