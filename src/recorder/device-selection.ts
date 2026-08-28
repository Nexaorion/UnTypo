export const recorderAudioConstraints = (
  microphoneDeviceId?: string,
): MediaTrackConstraints => ({
  autoGainControl: true,
  echoCancellation: true,
  noiseSuppression: true,
  ...(microphoneDeviceId ? { deviceId: { exact: microphoneDeviceId } } : {}),
});

export const isMissingMicrophoneError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'name' in error &&
  (error.name === 'NotFoundError' || error.name === 'OverconstrainedError');
