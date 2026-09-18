import type { ClientSettingsUpdate } from '../../shared/ipc.js';
import type { StoredClientConfig } from '../storage/configuration.js';

export const mergeSettingsUpdate = (
  config: StoredClientConfig,
  update: ClientSettingsUpdate,
): StoredClientConfig => {
  const {
    activeSpeechProviderProfileId,
    activeTextProviderProfileId,
    microphoneDeviceId,
    microphoneDeviceLabel,
    ...dictationUpdate
  } = update.dictation ?? {};
  const dictation = { ...config.dictation, ...dictationUpdate };
  if (activeSpeechProviderProfileId === null) {
    delete dictation.activeSpeechProviderProfileId;
  } else if (activeSpeechProviderProfileId !== undefined) {
    dictation.activeSpeechProviderProfileId = activeSpeechProviderProfileId;
  }
  if (activeTextProviderProfileId === null) {
    delete dictation.activeTextProviderProfileId;
  } else if (activeTextProviderProfileId !== undefined) {
    dictation.activeTextProviderProfileId = activeTextProviderProfileId;
  }
  if (microphoneDeviceId === null) {
    delete dictation.microphoneDeviceId;
    delete dictation.microphoneDeviceLabel;
  } else if (microphoneDeviceId !== undefined) {
    dictation.microphoneDeviceId = microphoneDeviceId;
  }
  if (microphoneDeviceLabel === null) {
    delete dictation.microphoneDeviceLabel;
  } else if (microphoneDeviceLabel !== undefined) {
    dictation.microphoneDeviceLabel = microphoneDeviceLabel;
  }
  return {
    ...config,
    diagnostics: { ...config.diagnostics, ...update.diagnostics },
    dictation,
    general: { ...config.general, ...update.general },
    history: { ...config.history, ...update.history },
    updates: { ...config.updates, ...update.updates },
  };
};
