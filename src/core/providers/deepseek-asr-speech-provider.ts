import {
  PROVIDER_CONTRACT_VERSION,
  ProviderContractError,
  type AudioPayload,
  type ProviderCapabilities,
  type SpeechRecognitionProvider,
  type TranscriptResult,
  type TranscribeOptions,
} from './types.js';
import {
  providerConfigSchema,
  providerUrl,
  readProviderJson,
  resolveProviderConfiguration,
  type ProviderConnectionConfiguration,
} from './http-utils.js';

export type DeepSeekAsrSpeechProviderConfiguration = ProviderConnectionConfiguration;

export const DEEPSEEK_ASR_BASE_URL = 'https://api.deepseek.com/v1';
export const DEEPSEEK_ASR_MODEL = 'deepseek-asr';
export const DEEPSEEK_ASR_PATH = '/tools/asr';
/** Covers the documented 10-minute upload window plus the recognition response. */
export const DEEPSEEK_ASR_REQUEST_TIMEOUT_MS = 11 * 60 * 1000;

const capabilities: Readonly<ProviderCapabilities> = {
  speechToText: true,
  textPolish: false,
  toneAdaptation: false,
  translation: false,
  instructionGeneration: false,
  intentDetection: false,
  streamingPartial: false,
};

const maximumDurationMs = 120_000;
const maximumUploadBytes = 8 * 1024 * 1024;
const wavSampleRates = new Set([8_000, 16_000, 22_050, 24_000, 32_000, 44_100, 48_000]);

interface WavLayout {
  bitsPerSample: number;
  channels: number;
  dataBytes: number;
  format: number;
  sampleRateHz: number;
}

interface PreparedAudio {
  bytes: Uint8Array;
  fileName: string;
  mediaType: string;
}

const asciiAt = (bytes: Uint8Array, offset: number, length: number): string => {
  let value = '';
  for (let index = 0; index < length; index += 1) {
    value += String.fromCharCode(bytes[offset + index] ?? 0);
  }
  return value;
};

const indexOfAscii = (bytes: Uint8Array, needle: string): number => {
  if (needle.length === 0 || bytes.byteLength < needle.length) return -1;
  const pattern = [...needle].map((character) => character.charCodeAt(0));
  const last = bytes.byteLength - pattern.length;
  for (let offset = 0; offset <= last; offset += 1) {
    let matched = true;
    for (let index = 0; index < pattern.length; index += 1) {
      if (bytes[offset + index] !== pattern[index]) {
        matched = false;
        break;
      }
    }
    if (matched) return offset;
  }
  return -1;
};

const readWavLayout = (bytes: Uint8Array): WavLayout | undefined => {
  if (bytes.byteLength < 12) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (asciiAt(bytes, 0, 4) !== 'RIFF' || asciiAt(bytes, 8, 4) !== 'WAVE') return undefined;

  let offset = 12;
  let format: number | undefined;
  let channels: number | undefined;
  let sampleRateHz: number | undefined;
  let bitsPerSample: number | undefined;
  let dataBytes: number | undefined;
  while (offset + 8 <= bytes.byteLength) {
    const id = asciiAt(bytes, offset, 4);
    const size = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (size > bytes.byteLength - start) return undefined;
    if (id === 'fmt ' && size >= 16) {
      format = view.getUint16(start, true);
      channels = view.getUint16(start + 2, true);
      sampleRateHz = view.getUint32(start + 4, true);
      bitsPerSample = view.getUint16(start + 14, true);
    } else if (id === 'data') {
      dataBytes = size;
    }
    offset = start + size + (size % 2);
  }

  if (
    format === undefined ||
    channels === undefined ||
    sampleRateHz === undefined ||
    bitsPerSample === undefined ||
    dataBytes === undefined
  ) {
    return undefined;
  }
  return { bitsPerSample, channels, dataBytes, format, sampleRateHz };
};

const isOggOpus = (bytes: Uint8Array): boolean =>
  bytes.byteLength >= 36 && asciiAt(bytes, 0, 4) === 'OggS' && indexOfAscii(bytes, 'OpusHead') >= 0;

const invalidAudio = (message: string): ProviderContractError =>
  new ProviderContractError('INVALID_OPTIONS', message);

const prepareAudio = (audio: AudioPayload): PreparedAudio => {
  if (!Number.isFinite(audio.durationMs) || audio.durationMs < 0) {
    throw invalidAudio('DeepSeek ASR audio duration is invalid');
  }
  if (audio.durationMs > maximumDurationMs) {
    throw invalidAudio('DeepSeek ASR audio cannot exceed 120 seconds');
  }
  if (audio.bytes.byteLength > maximumUploadBytes) {
    throw invalidAudio('DeepSeek ASR audio cannot exceed 8 MiB');
  }

  const wav = readWavLayout(audio.bytes);
  if (wav) {
    if (wav.format !== 1 || wav.bitsPerSample !== 16) {
      throw invalidAudio('DeepSeek ASR WAV audio must be 16-bit PCM');
    }
    if (wav.channels !== 1 && wav.channels !== 2) {
      throw invalidAudio('DeepSeek ASR WAV audio must be mono or stereo');
    }
    if (!wavSampleRates.has(wav.sampleRateHz)) {
      throw invalidAudio(
        'DeepSeek ASR WAV sample rate must be 8000, 16000, 22050, 24000, 32000, 44100, or 48000 Hz',
      );
    }
    const frameBytes = wav.channels * 2;
    if (wav.dataBytes === 0 || wav.dataBytes % frameBytes !== 0) {
      throw invalidAudio('DeepSeek ASR WAV audio must contain complete 16-bit samples');
    }
    const maximumFrames = Math.floor((wav.sampleRateHz * maximumDurationMs) / 1_000);
    if (wav.dataBytes / frameBytes > maximumFrames) {
      throw invalidAudio('DeepSeek ASR audio cannot exceed 120 seconds');
    }
    return { bytes: audio.bytes, fileName: 'speech.wav', mediaType: 'audio/wav' };
  }

  if (isOggOpus(audio.bytes)) {
    return { bytes: audio.bytes, fileName: 'speech.ogg', mediaType: 'audio/ogg' };
  }

  throw invalidAudio('DeepSeek ASR accepts 16-bit PCM WAV or Ogg Opus audio');
};

const documentedStatusDetail = (status: number): string | undefined => {
  switch (status) {
    case 400:
      return 'the audio is not 16-bit PCM WAV or Ogg Opus, or the file field is missing';
    case 408:
      return 'the upload timed out after 10 minutes';
    case 413:
      return 'the audio file is larger than 8 MiB';
    case 429:
      return 'too many requests are already in progress (maximum 50)';
    case 503:
      return 'the speech service is busy';
    case 504:
      return 'recognition timed out';
    default:
      return undefined;
  }
};

const readDeepSeekAsrJson = async (response: Response): Promise<unknown> => {
  try {
    return await readProviderJson(response, 'DeepSeek ASR');
  } catch (error) {
    const detail = documentedStatusDetail(response.status);
    if (!detail || !(error instanceof Error) || error.message.includes(detail)) throw error;
    throw new Error(`${error.message} (${detail})`, { cause: error });
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const transcriptFromPayload = (payload: unknown, fallbackDurationMs: number): TranscriptResult => {
  if (!isRecord(payload) || typeof payload.text !== 'string') {
    throw new ProviderContractError(
      'INVALID_PROVIDER',
      'DeepSeek ASR returned an invalid transcript',
    );
  }
  if (!payload.text.trim()) {
    throw new ProviderContractError('EMPTY_RESULT', 'DeepSeek ASR returned an empty transcript');
  }
  const duration = payload.duration_ms;
  const audioDurationMs =
    typeof duration === 'number' && Number.isFinite(duration) && duration >= 0
      ? Math.round(duration)
      : fallbackDurationMs;
  return {
    text: payload.text,
    usage: { audioDurationMs },
  };
};

export class DeepSeekAsrSpeechProvider implements SpeechRecognitionProvider {
  readonly capabilities = capabilities;
  readonly configSchema = providerConfigSchema;
  readonly contractVersion = PROVIDER_CONTRACT_VERSION;
  readonly displayName: string;
  readonly id: string;
  readonly kind = 'builtin' as const;
  // The recorder emits 16 kHz mono 16-bit PCM WAV when this format is requested.
  readonly preferredAudioFormat = 'wav' as const;
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;

  constructor(
    configuration: DeepSeekAsrSpeechProviderConfiguration,
    fetchImplementation: typeof fetch = fetch,
  ) {
    const resolved = resolveProviderConfiguration(configuration, {
      baseUrl: DEEPSEEK_ASR_BASE_URL,
      model: DEEPSEEK_ASR_MODEL,
    });
    this.id = resolved.id;
    this.displayName = resolved.displayName;
    this.#apiKey = resolved.apiKey;
    this.#baseUrl = resolved.baseUrl;
    this.#fetch = fetchImplementation;
  }

  async transcribe(audio: AudioPayload, options: TranscribeOptions): Promise<TranscriptResult> {
    const prepared = prepareAudio(audio);
    const copy = Uint8Array.from(prepared.bytes);
    const form = new FormData();
    form.append('file', new Blob([copy], { type: prepared.mediaType }), prepared.fileName);

    const timeoutSignal = AbortSignal.timeout(DEEPSEEK_ASR_REQUEST_TIMEOUT_MS);
    // The endpoint accepts only the audio file and detects the language itself.
    const response = await this.#fetch(providerUrl(this.#baseUrl, DEEPSEEK_ASR_PATH), {
      body: form,
      headers: { Authorization: `Bearer ${this.#apiKey}` },
      method: 'POST',
      signal: options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal,
    });
    const payload = await readDeepSeekAsrJson(response);
    return {
      language: options.language,
      ...transcriptFromPayload(payload, audio.durationMs),
    };
  }
}
