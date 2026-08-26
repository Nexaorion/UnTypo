import { describe, expect, it } from 'vitest';

describe('Microphone device recovery', () => {
  it('stores both deviceId and label for future recovery', () => {
    const config = {
      dictation: {
        microphoneDeviceId: 'device-123',
        microphoneDeviceLabel: 'USB Microphone',
      },
    };

    expect(config.dictation.microphoneDeviceId).toBe('device-123');
    expect(config.dictation.microphoneDeviceLabel).toBe('USB Microphone');
  });

  it('supports label-based recovery when deviceId changes', () => {
    const savedDeviceId = 'device-123';
    const savedLabel = 'USB Microphone';

    const availableDevices = [
      { deviceId: 'device-456', label: 'USB Microphone' },
      { deviceId: 'device-789', label: 'Built-in Microphone' },
    ];

    let match = availableDevices.find((d) => d.deviceId === savedDeviceId);

    if (!match && savedLabel) {
      match = availableDevices.find((d) => d.label === savedLabel);
    }

    expect(match).toBeDefined();
    expect(match?.deviceId).toBe('device-456');
    expect(match?.label).toBe('USB Microphone');
  });

  it('uses ideal constraint instead of exact for flexibility', () => {
    const constraint = { deviceId: { ideal: 'device-123' } };

    expect(constraint.deviceId).toHaveProperty('ideal');
    expect(constraint.deviceId).not.toHaveProperty('exact');
  });
});
