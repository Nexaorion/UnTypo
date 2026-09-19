import { describe, expect, it } from 'vitest';
import {
  createBackupFileName,
  normalizeBackupDeviceName,
  parseBackupFileName,
} from '../../../src/main/sync/backup-name';

describe('backup names', () => {
  it('round-trips the backup timestamp and device name', () => {
    const createdAt = 1_700_000_000_000;
    const name = createBackupFileName(createdAt, 'MengXi MacBook Pro');

    expect(parseBackupFileName(name)).toEqual({
      createdAt,
      deviceName: 'MengXi MacBook Pro',
    });
  });

  it('normalizes unsafe device names and rejects unrelated files', () => {
    const nullCharacter = String.fromCharCode(0);
    expect(normalizeBackupDeviceName(`  Desk${nullCharacter}top  `)).toBe('Desktop');
    expect(normalizeBackupDeviceName(nullCharacter)).toBe('Unknown device');
    expect(parseBackupFileName('notes.txt')).toBeUndefined();
    expect(parseBackupFileName('untypo-1700000000000-not-base64!!.untypo')).toBeUndefined();
  });
});
