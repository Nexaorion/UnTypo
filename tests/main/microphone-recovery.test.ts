import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { recorderAudioConstraints } from '../../src/recorder/device-selection';
import { ConfigurationService } from '../../src/main/storage/configuration';
import { MemorySecretProtector } from '../../src/main/storage/secret-protector';
import { resolveMicrophoneSelection } from '../../src/shared/microphone';

describe('Microphone device recovery', () => {
  it('persists an explicit microphone through the production configuration service', async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), 'untypo-microphone-'),
    );
    try {
      const configuration = new ConfigurationService(
        path.join(directory, 'config.json'),
        new MemorySecretProtector(),
      );
      await configuration.update((config) => ({
        ...config,
        dictation: {
          ...config.dictation,
          microphoneDeviceId: 'device-123',
          microphoneDeviceLabel: 'USB Microphone',
        },
      }));

      await expect(configuration.load()).resolves.toMatchObject({
        dictation: {
          microphoneDeviceId: 'device-123',
          microphoneDeviceLabel: 'USB Microphone',
        },
      });
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('uses an exact recorder constraint for the selected microphone', () => {
    expect(recorderAudioConstraints('device-123')).toMatchObject({
      deviceId: { exact: 'device-123' },
    });
  });

  it('recovers a rotated device id from one matching persistent label', () => {
    expect(
      resolveMicrophoneSelection(
        { deviceId: 'old-id', label: ' USB   Microphone ' },
        [
          { deviceId: 'default', label: 'Default - USB Microphone' },
          { deviceId: 'new-id', label: 'USB Microphone' },
        ],
      ),
    ).toEqual({ deviceId: 'new-id', label: 'USB Microphone' });
  });

  it('does not recover when a label is ambiguous or generated', () => {
    expect(
      resolveMicrophoneSelection(
        { deviceId: 'old-id', label: 'USB Microphone' },
        [
          { deviceId: 'first', label: 'USB Microphone' },
          { deviceId: 'second', label: 'USB Microphone' },
        ],
      ),
    ).toBeUndefined();
    expect(
      resolveMicrophoneSelection(
        { deviceId: 'old-id', label: 'Microphone 1' },
        [
          {
            deviceId: 'new-id',
            generatedLabel: true,
            label: 'Microphone 1',
          },
        ],
      ),
    ).toBeUndefined();
  });
});
