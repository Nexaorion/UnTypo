import { net } from 'electron';
import {
  AliyunBailianSpeechProvider,
  type ProviderWebSocketFactory,
} from '../../core/providers/aliyun-bailian-speech-provider.js';
import { AnthropicTextProvider } from '../../core/providers/anthropic-text-provider.js';
import type {
  AudioPayload,
  SpeechRecognitionProvider,
  TextGenerationProvider,
} from '../../core/providers/types.js';
import { OpenAICompatibleSpeechProvider } from '../../core/providers/openai-compatible-speech-provider.js';
import {
  OpenAICompatibleTextProvider,
  type OpenAICompatibleTextProviderConfiguration,
} from '../../core/providers/openai-compatible-text-provider.js';
import { OpenAIResponsesTextProvider } from '../../core/providers/openai-responses-text-provider.js';
import type { ProviderProfile } from '../storage/config-store.js';

const isString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const createProviderWebSocket: ProviderWebSocketFactory = (url, headers) => {
  const socket = new net.WebSocket(url, { headers: { ...headers } });
  return {
    close: () => socket.close(),
    onClose: (listener) => {
      socket.addEventListener('close', () => listener());
    },
    onError: (listener) => {
      socket.addEventListener('error', () => listener());
    },
    onMessage: (listener) => {
      socket.addEventListener('message', (event) => {
        if ('data' in event) listener(event.data);
      });
    },
    onOpen: (listener) => {
      socket.addEventListener('open', () => listener());
    },
    send: (data) => socket.send(data),
  };
};

const toProviderConfiguration = (
  profile: ProviderProfile,
): OpenAICompatibleTextProviderConfiguration | undefined => {
  const apiKey = profile.secrets.apiKey;
  if (!isString(apiKey)) {
    return undefined;
  }
  return {
    apiKey,
    baseUrl: profile.values.baseUrl,
    displayName: profile.values.name,
    id: profile.id,
    model: profile.values.model,
    ...(typeof profile.values.allowInsecurePrivateEndpoint === 'boolean'
      ? {
          allowInsecurePrivateEndpoint: profile.values.allowInsecurePrivateEndpoint,
        }
      : {}),
  };
};

export const createTextProvider = (
  profile: ProviderProfile,
  fetchImplementation: typeof fetch = fetch,
): TextGenerationProvider => {
  if (profile.kind !== 'text') {
    throw new Error('Text provider profile has the wrong kind');
  }
  const configuration = toProviderConfiguration(profile);
  if (!configuration) throw new Error('Provider profile is incomplete');
  if (profile.providerId === 'openai-compatible-text') {
    return new OpenAICompatibleTextProvider(configuration, fetchImplementation);
  }
  if (profile.providerId === 'openai-responses-text') {
    return new OpenAIResponsesTextProvider(configuration, fetchImplementation);
  }
  if (profile.providerId === 'anthropic-text') {
    return new AnthropicTextProvider(configuration, fetchImplementation);
  }
  throw new Error('Text provider profile has an unsupported provider id');
};

export const createSpeechProvider = (
  profile: ProviderProfile,
  fetchImplementation: typeof fetch = fetch,
): SpeechRecognitionProvider => {
  if (profile.kind !== 'speech') {
    throw new Error('Speech provider profile has the wrong kind');
  }
  const configuration = toProviderConfiguration(profile);
  if (!configuration) throw new Error('Provider profile is incomplete');
  if (profile.providerId === 'openai-compatible-speech') {
    return new OpenAICompatibleSpeechProvider(configuration, fetchImplementation);
  }
  if (profile.providerId === 'aliyun-bailian-speech') {
    return new AliyunBailianSpeechProvider(
      {
        ...configuration,
        realtimeSpeechEnabled: profile.values.realtimeSpeechEnabled === true,
      },
      fetchImplementation,
      createProviderWebSocket,
    );
  }
  throw new Error('Speech provider profile has an unsupported provider id');
};

const createConnectionTestWav = (): AudioPayload => {
  const channels = 1;
  const durationMs = 1_000;
  const sampleRateHz = 16_000;
  const bytesPerSample = 2;
  const sampleCount = Math.floor((sampleRateHz * durationMs) / 1_000);
  const audioByteLength = sampleCount * channels * bytesPerSample;
  const wav = Buffer.alloc(44 + audioByteLength);
  wav.write('RIFF', 0, 'ascii');
  wav.writeUInt32LE(36 + audioByteLength, 4);
  wav.write('WAVE', 8, 'ascii');
  wav.write('fmt ', 12, 'ascii');
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(channels, 22);
  wav.writeUInt32LE(sampleRateHz, 24);
  wav.writeUInt32LE(sampleRateHz * channels * bytesPerSample, 28);
  wav.writeUInt16LE(channels * bytesPerSample, 32);
  wav.writeUInt16LE(bytesPerSample * 8, 34);
  wav.write('data', 36, 'ascii');
  wav.writeUInt32LE(audioByteLength, 40);
  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    const sample = Math.round(Math.sin((2 * Math.PI * 440 * sampleIndex) / sampleRateHz) * 0x1800);
    wav.writeInt16LE(sample, 44 + sampleIndex * bytesPerSample);
  }
  return {
    bytes: new Uint8Array(wav),
    channels,
    durationMs,
    mimeType: 'audio/wav',
    sampleRateHz,
  };
};

export const testProviderConnection = async (
  profile: ProviderProfile,
  fetchImplementation: typeof fetch = fetch,
): Promise<void> => {
  if (profile.kind === 'text') {
    const provider = createTextProvider(profile, fetchImplementation);
    await provider.processTranscript('Transcribe this connection test.', {
      defaultTargetLanguage: 'en-US',
      dictionary: [],
      forcedIntent: 'transcription',
      locale: 'en-US',
    });
    return;
  }
  const provider = createSpeechProvider(profile, fetchImplementation);
  if (provider instanceof AliyunBailianSpeechProvider) {
    await provider.testConnection();
    return;
  }
  await provider.transcribe(createConnectionTestWav(), {
    dictionary: [],
    language: 'en-US',
  });
};
