import { describe, expect, it, vi } from 'vitest';

import { buildUserProfileContext } from '../../src/main/dictation/dictation-context.js';
import type { DictationContext } from '../../src/main/dictation/coordinator.js';
import type { ConfigurationService } from '../../src/main/storage/config-store.js';
import type { WritingPreferenceLearningService } from '../../src/main/personalization/style-learner.js';
import type { ProviderActivationService } from '../../src/main/providers/provider-activation.js';
import { createStoredConfig, createStoredProvider } from './fixtures.js';

const learnedPreferences = [{ id: 'preference-1' }];

const createContext = async (providers: ProviderActivationService): Promise<DictationContext> => {
  const configuration = {
    getProfile: vi.fn(() => ({ name: 'Tester' })),
    load: vi.fn(() =>
      createStoredConfig({
        dictation: {
          activeSpeechProviderProfileId: 'speech-1',
          activeTextProviderProfileId: 'text-1',
          defaultTargetLanguage: 'zh-CN',
          language: 'en-US',
          microphoneDeviceId: 'device-1',
          microphoneDeviceLabel: 'Microphone',
        },
        dictionary: [{ term: 'UnTypo' }],
        providers: [
          createStoredProvider('speech-1', 'speech'),
          createStoredProvider('text-1', 'text'),
        ],
      }),
    ),
  } as unknown as ConfigurationService;
  const preferenceLearning = {
    getPreferences: vi.fn(() => learnedPreferences),
  } as unknown as WritingPreferenceLearningService;
  return buildUserProfileContext({
    configuration,
    preferenceLearning,
    providers,
  });
};

const createProviders = (
  speechProviderId: string | undefined,
  textProviderId: string | undefined,
): ProviderActivationService =>
  ({
    speechProviderId,
    textProviderId,
  }) as unknown as ProviderActivationService;

describe('buildUserProfileContext', () => {
  it('maps configuration and learning state onto the dictation context', async () => {
    const context = await createContext(createProviders('speech-1', 'text-1'));

    expect(context.speechProviderId).toBe('speech-1');
    expect(context.textProviderId).toBe('text-1');
    expect(context.modelName).toBe('model-speech-1');
    expect(context.speechProviderDetails).toEqual({
      modelName: 'model-speech-1',
      providerName: 'Provider speech-1',
      providerType: 'openai-compatible-speech',
    });
    expect(context.textProviderDetails).toEqual({
      modelName: 'model-text-1',
      providerName: 'Provider text-1',
      providerType: 'openai-compatible-text',
    });
    expect(context.options.dictionary).toEqual(['UnTypo']);
    expect(context.options.defaultTargetLanguage).toBe('zh-CN');
    expect(context.options.language).toBe('en-US');
    expect(context.options.profile).toEqual({ name: 'Tester' });
    expect(context.microphoneSelection).toEqual({
      deviceId: 'device-1',
      label: 'Microphone',
    });
    expect(context.learnedPreferences).toBe(learnedPreferences);
    expect(context.preferenceLearningEnabled).toBe(true);
    expect(context.options.dictionaryLearningEnabled).toBe(true);
    expect(context.uiLanguage).toBe('en-US');
  });

  it('requires an active speech provider before dictation can run', async () => {
    await expect(createContext(createProviders(undefined, 'text-1'))).rejects.toThrow(
      'No speech recognition model is configured',
    );
  });

  it('disables learning features when no text provider is active', async () => {
    const context = await createContext(createProviders('speech-1', undefined));

    expect(context.textProviderId).toBeUndefined();
    expect(context.textProviderDetails).toBeUndefined();
    expect(context.preferenceLearningEnabled).toBe(false);
    expect(context.options.dictionaryLearningEnabled).toBe(false);
  });
});
