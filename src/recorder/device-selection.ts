export const recorderAudioConstraints = (
  microphoneDeviceId?: string,
): MediaTrackConstraints => ({
  autoGainControl: true,
  echoCancellation: true,
  noiseSuppression: true,
  ...(microphoneDeviceId ? { deviceId: { ideal: microphoneDeviceId } } : {}),
});
