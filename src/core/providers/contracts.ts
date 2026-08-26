export const PROVIDER_CONTRACT_VERSION = '3.0' as const;

export type ProviderContractVersion = typeof PROVIDER_CONTRACT_VERSION;
export type DictationIntent = 'transcription' | 'translation' | 'instruction';
export type ProviderKind = 'builtin' | 'community' | 'official-cloud' | 'local';
export type ProviderAudioFormat = 'wav' | 'webm';
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

export interface TextProcessContext {
  defaultTargetLanguage: SupportedLanguage;
  dictionary: readonly string[];
  explicitTargetLanguage?: SupportedLanguage;
  forcedIntent?: DictationIntent;
  locale: SupportedLanguage;
  profile?: UserProfileContext;
  signal?: AbortSignal;
  tone?: string;
  windowContext?: WindowContext;
}

export interface WindowContext {
  isTextEntry: boolean;
  processId: number;
  windowHandle: string;
}

export interface TextProcessResult {
  intent: DictationIntent;
  outputText: string;
}

export interface ProcessOptions {
  defaultTargetLanguage: SupportedLanguage;
  dictionary: readonly string[];
  explicitTargetLanguage?: SupportedLanguage;
  fastMode?: boolean;
  forcedIntent?: DictationIntent;
  language: SupportedLanguage;
  preferIntegratedProcess?: boolean;
  profile?: UserProfileContext;
  signal?: AbortSignal;
  tone?: string;
  windowContext?: WindowContext;
}

export interface ProcessResult {
  intent: DictationIntent;
  outputText: string;
  rawTranscript?: string;
  usage?: ProviderUsage;
}

export interface ProviderIdentity {
  capabilities: Readonly<ProviderCapabilities>;
  configSchema: Readonly<Record<string, unknown>>;
  contractVersion: ProviderContractVersion;
  displayName: string;
  id: string;
  kind: ProviderKind;
}

export interface SpeechRecognitionProvider extends ProviderIdentity {
  readonly preferredAudioFormat?: ProviderAudioFormat;
  transcribe: (
    audio: AudioPayload,
    options: TranscribeOptions,
  ) => Promise<TranscriptResult>;
}

export interface TextGenerationProvider extends ProviderIdentity {
  processTranscript: (
    text: string,
    context: TextProcessContext,
  ) => Promise<TextProcessResult>;
}

/**
 * Compatibility contract for providers that still implement both roles.
 * New runtime code should register speech and text providers independently.
 */
export interface DictationProvider
  extends SpeechRecognitionProvider, TextGenerationProvider {
  process?: (
    audio: AudioPayload,
    options: ProcessOptions,
  ) => Promise<ProcessResult>;
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

const providerIdPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/u;

const assertProviderIdentity = (provider: ProviderIdentity): void => {
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
};

export const assertSpeechProviderContract = (
  provider: SpeechRecognitionProvider,
): void => {
  assertProviderIdentity(provider);
  if (!provider.capabilities.speechToText) {
    throw new ProviderContractError(
      'INVALID_PROVIDER',
      `Speech provider ${provider.id} must support speech-to-text`,
    );
  }
  if (typeof provider.transcribe !== 'function') {
    throw new ProviderContractError(
      'INVALID_PROVIDER',
      `Speech provider ${provider.id} must implement transcribe`,
    );
  }
};

export const assertTextProviderContract = (
  provider: TextGenerationProvider,
): void => {
  assertProviderIdentity(provider);
  if (typeof provider.processTranscript !== 'function') {
    throw new ProviderContractError(
      'INVALID_PROVIDER',
      `Text provider ${provider.id} must implement processTranscript`,
    );
  }
};

export const assertProviderContract = (provider: DictationProvider): void => {
  assertSpeechProviderContract(provider);
  assertTextProviderContract(provider);
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
