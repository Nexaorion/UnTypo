import { systemPreferences } from 'electron';
import type { ClientPermissionSnapshot, ClientSnapshot } from '../../shared/ipc.js';
import type { WritingPreferenceLearningService } from '../personalization/learning.js';
import type { ApplicationUpdateService } from '../update/application-update-service.js';
import type { ConfigurationService } from '../storage/configuration.js';
import type { SyncService } from '../sync/sync-service.js';

export interface ClientSnapshotOptions {
  configuration: ConfigurationService;
  preferenceLearning: WritingPreferenceLearningService;
  sync: SyncService;
  updates: ApplicationUpdateService;
}

const darwinPermissionSnapshot = (): ClientPermissionSnapshot | undefined => {
  if (process.platform !== 'darwin') return undefined;
  return {
    accessibility: systemPreferences.isTrustedAccessibilityClient(false) ? 'granted' : 'denied',
    microphone: systemPreferences.getMediaAccessStatus('microphone'),
  };
};

export const buildClientSnapshot = async (
  options: ClientSnapshotOptions,
): Promise<ClientSnapshot> => {
  const { configuration, preferenceLearning, sync, updates } = options;
  const [config, profile, memory] = await Promise.all([
    configuration.load(),
    configuration.getProfile(),
    preferenceLearning.snapshot(),
  ]);
  const permissions = darwinPermissionSnapshot();
  return {
    dictionary: config.dictionary,
    dictionaryLearning: { enabled: config.dictionaryLearning.enabled },
    personalization: {
      applicationStyles: structuredClone(config.personalization.applicationStyles),
      learningEnabled: config.personalization.learningEnabled,
      preferences: memory.preferences,
      suggestions: memory.suggestions,
    },
    ...(profile ? { profile } : {}),
    ...(permissions ? { permissions } : {}),
    providers: config.providers.map((provider) => ({
      configuredSecretKeys: Object.keys(provider.secrets),
      id: provider.id,
      kind: provider.kind,
      providerId: provider.providerId,
      values: structuredClone(provider.values),
    })),
    settings: {
      diagnostics: config.diagnostics,
      dictation: {
        ...(config.dictation.activeSpeechProviderProfileId
          ? {
              activeSpeechProviderProfileId: config.dictation.activeSpeechProviderProfileId,
            }
          : {}),
        ...(config.dictation.activeTextProviderProfileId
          ? {
              activeTextProviderProfileId: config.dictation.activeTextProviderProfileId,
            }
          : {}),
        defaultTargetLanguage: config.dictation.defaultTargetLanguage,
        ...(config.dictation.fastMode !== undefined ? { fastMode: config.dictation.fastMode } : {}),
        hotkeyAccelerator: config.dictation.hotkeyAccelerator,
        language: config.dictation.language,
        ...(config.dictation.microphoneDeviceId
          ? { microphoneDeviceId: config.dictation.microphoneDeviceId }
          : {}),
        ...(config.dictation.microphoneDeviceLabel
          ? { microphoneDeviceLabel: config.dictation.microphoneDeviceLabel }
          : {}),
      },
      general: config.general,
      history: config.history,
      telemetry: config.telemetry,
      updates: config.updates,
    },
    sync: await sync.snapshot(),
    update: updates.snapshot(),
  };
};
