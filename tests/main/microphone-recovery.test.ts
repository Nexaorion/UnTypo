import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { recorderAudioConstraints } from '../../src/recorder/device-selection';
import { ConfigurationService } from '../../src/main/storage/configuration';
import { MemorySecretProtector } from '../../src/main/storage/secret-protector';

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
        dictation: { ...config.dictation, microphoneDeviceId: 'device-123' },
      }));

      await expect(configuration.load()).resolves.toMatchObject({
        dictation: { microphoneDeviceId: 'device-123' },
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
});
