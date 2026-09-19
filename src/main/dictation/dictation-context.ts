import type { DictationContext } from './coordinator.js';
import type { WritingPreferenceLearningService } from '../personalization/learning.js';
import type { ProviderActivationService } from '../providers/provider-activation.js';
import type { ConfigurationService } from '../storage/configuration.js';

export interface DictationContextOptions {
  configuration: ConfigurationService;
  preferenceLearning: WritingPreferenceLearningService;
  providers: ProviderActivationService;
}

export const buildUserProfileContext = async (
  options: DictationContextOptions,
): Promise<DictationContext> => {
  const { configuration, preferenceLearning, providers } = options;
  const current = await configuration.load();
  const speechProviderId = providers.speechProviderId;
  if (!speechProviderId) {
    throw new Error('No speech recognition model is configured');
  }
  const activeSpeechProfile = current.providers.find(
    ({ id, kind }) => id === speechProviderId && kind === 'speech',
  );
  const activeTextProfile = current.providers.find(
    ({ id, kind }) => id === providers.textProviderId && kind === 'text',
  );
  const [profile, learnedPreferences] = await Promise.all([
    configuration.getProfile(),
    preferenceLearning.getPreferences(),
  ]);
  return {
    applicationStyles: current.personalization.applicationStyles,
    history: current.history,
    learnedPreferences,
    ...(current.dictation.fastMode !== undefined ? { fastMode: current.dictation.fastMode } : {}),
    modelName: activeSpeechProfile?.values.model ?? speechProviderId,
    ...(current.dictation.microphoneDeviceId
      ? {
          microphoneSelection: {
            deviceId: current.dictation.microphoneDeviceId,
            ...(current.dictation.microphoneDeviceLabel
              ? { label: current.dictation.microphoneDeviceLabel }
              : {}),
          },
        }
      : {}),
    options: {
      defaultTargetLanguage: current.dictation.defaultTargetLanguage,
      dictionary: current.dictionary.map(({ term }) => term),
      dictionaryLearningEnabled:
        current.dictionaryLearning.enabled && providers.textProviderId !== undefined,
      ...(current.dictation.fastMode !== undefined ? { fastMode: current.dictation.fastMode } : {}),
      language: current.dictation.language,
      preferIntegratedProcess: false,
      profile,
    },
    preferenceLearningEnabled:
      current.personalization.learningEnabled && providers.textProviderId !== undefined,
    speechProviderId,
    ...(activeSpeechProfile
      ? {
          speechProviderDetails: {
            modelName: activeSpeechProfile.values.model,
            providerName: activeSpeechProfile.values.name,
            providerType: activeSpeechProfile.providerId,
          },
        }
      : {}),
    ...(providers.textProviderId ? { textProviderId: providers.textProviderId } : {}),
    ...(activeTextProfile
      ? {
          textProviderDetails: {
            modelName: activeTextProfile.values.model,
            providerName: activeTextProfile.values.name,
            providerType: activeTextProfile.providerId,
          },
        }
      : {}),
    uiLanguage: current.general.locale,
  };
};
