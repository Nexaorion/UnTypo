import { app, net } from 'electron';
import {
  AliyunBailianSpeechProvider,
  type ProviderWebSocketFactory,
} from '../../core/providers/aliyun-bailian-speech-provider.js';
import { AnthropicTextProvider } from '../../core/providers/anthropic-text-provider.js';
import {
  ConnectionCheckError,
  finishConnectionCheck,
  loadConnectionCheckAudio,
} from '../../core/providers/connection-check.js';
import { DeepSeekAsrSpeechProvider } from '../../core/providers/deepseek-asr-speech-provider.js';
import type {
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
  if (profile.providerId === 'deepseek-asr-speech') {
    return new DeepSeekAsrSpeechProvider(configuration, fetchImplementation);
  }
  throw new Error('Speech provider profile has an unsupported provider id');
};

export interface ProviderConnectionTestOptions {
  signal?: AbortSignal;
}

export const testProviderConnection = async (
  profile: ProviderProfile,
  fetchImplementation: typeof fetch = fetch,
  options: ProviderConnectionTestOptions = {},
): Promise<void> => {
  if (options.signal?.aborted) {
    throw new ConnectionCheckError('cancelled', 'Connection check was cancelled');
  }
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
  const audio = loadConnectionCheckAudio(
    app.isPackaged
      ? { isPackaged: true, resourcesPath: process.resourcesPath }
      : { appPath: app.getAppPath() },
  );
  const provider = createSpeechProvider(profile, fetchImplementation);
  if (provider instanceof AliyunBailianSpeechProvider) {
    await provider.testConnection({ audio, signal: options.signal });
    return;
  }
  await finishConnectionCheck(
    () =>
      provider.transcribe(audio, {
        dictionary: [],
        language: 'en-US',
        signal: options.signal,
      }),
    options.signal,
  );
};
