import { describe, expect, it } from 'vitest';
import {
  BACKUP_CODE_ALPHABET,
  generateBackupCode,
  isValidBackupCode,
  parseBackupCode,
} from '../../../src/main/sync/backup-code';

describe('backup codes', () => {
  it('generates an 8-character code from the unambiguous alphabet', () => {
    const code = generateBackupCode();
    expect(code).toHaveLength(8);
    expect(
      [...code].every((character) => BACKUP_CODE_ALPHABET.includes(character)),
    ).toBe(true);
    expect(code).not.toMatch(/[0O1I]/u);
  });

  it('accepts custom codes after normalization', () => {
    expect(parseBackupCode('  k7m2nx4p  ')).toBe('K7M2NX4P');
    expect(isValidBackupCode('TOO-SHORT')).toBe(false);
    expect(isValidBackupCode('O1234567')).toBe(false);
  });
});
