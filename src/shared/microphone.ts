export interface MicrophoneDeviceInfo {
  deviceId: string;
  generatedLabel?: boolean;
  label: string;
}

export interface MicrophoneSelection {
  deviceId: string;
  label?: string;
}

const microphoneLabelKey = (value: string): string =>
  value.trim().replace(/\s+/gu, ' ').toLowerCase();

export const resolveMicrophoneSelection = (
  selection: MicrophoneSelection,
  devices: readonly MicrophoneDeviceInfo[],
): MicrophoneSelection | undefined => {
  const exact = devices.find(({ deviceId }) => deviceId === selection.deviceId);
  if (exact) {
    return {
      deviceId: exact.deviceId,
      ...(!exact.generatedLabel ? { label: exact.label } : {}),
    };
  }

  if (!selection.label) return undefined;
  const labelKey = microphoneLabelKey(selection.label);
  const matches = devices.filter(
    ({ deviceId, generatedLabel, label }) =>
      deviceId !== 'default' &&
      !generatedLabel &&
      microphoneLabelKey(label) === labelKey,
  );
  const [match] = matches;
  if (matches.length !== 1 || !match) return undefined;
  return { deviceId: match.deviceId, label: match.label };
};
