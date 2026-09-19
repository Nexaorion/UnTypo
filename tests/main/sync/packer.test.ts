import { describe, expect, it } from 'vitest';
import {
  packSyncFile,
  unpackSyncFile,
  UNTYPO_FILE_MAGIC,
  UNTYPO_FILE_VERSION,
} from '../../../src/main/sync/packer';

const payload = {
  deviceName: 'DESKTOP-TEST',
  dictionary: [{ source: 'manual' as const, term: 'UnTypo' }],
  exportedAt: 1_700_000_000_000,
  history: [],
  personalization: {
    applicationStyles: {
      'ai-tool': 'prompt',
      browser: 'auto',
      'chat-app': 'casual',
      general: 'auto',
      ide: 'concise',
      office: 'formal',
    },
    learningEnabled: false,
  },
  profile: { displayName: 'Hikaru' },
  version: UNTYPO_FILE_VERSION,
};

describe('untypo packer', () => {
  it('round-trips an encrypted backup asynchronously', async () => {
    const packedPromise = packSyncFile(payload, 'K7M2NX4P', {
      appVersion: '0.1.10',
      createdAt: payload.exportedAt,
    });
    expect(packedPromise).toBeInstanceOf(Promise);
    const packed = await packedPromise;
    expect(packed.subarray(0, 8).equals(UNTYPO_FILE_MAGIC)).toBe(true);
    await expect(unpackSyncFile(packed, 'K7M2NX4P')).resolves.toMatchObject(payload);
  });

  it('rejects the wrong backup code', async () => {
    const packed = await packSyncFile(payload, 'K7M2NX4P', {
      appVersion: '0.1.10',
    });
    await expect(unpackSyncFile(packed, 'K7M2NX4Q')).rejects.toThrow(
      'The password is incorrect or the file is damaged',
    );
  });
});
