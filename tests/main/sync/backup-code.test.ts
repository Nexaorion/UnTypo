import { beforeEach, describe, expect, it, vi } from 'vitest';

const randomInt = vi.hoisted(() => vi.fn());

vi.mock('node:crypto', () => ({ randomInt }));

import {
  BACKUP_CODE_ALPHABET,
  generateBackupCode,
  isValidBackupCode,
  parseBackupCode,
} from '../../../src/main/sync/backup-code';

describe('backup codes', () => {
  beforeEach(() => {
    randomInt.mockReset();
    randomInt.mockReturnValue(0);
  });

  it('generates an 8-character code from the unambiguous alphabet', () => {
    const code = generateBackupCode();
    expect(code).toHaveLength(8);
    expect([...code].every((character) => BACKUP_CODE_ALPHABET.includes(character))).toBe(true);
    expect(code).not.toMatch(/[0O1I]/u);
    expect(randomInt).toHaveBeenCalledTimes(8);
    expect(randomInt).toHaveBeenCalledWith(BACKUP_CODE_ALPHABET.length);
  });

  it('maps the highest random index to the final alphabet character', () => {
    randomInt.mockReturnValue(BACKUP_CODE_ALPHABET.length - 1);

    expect(generateBackupCode()).toBe('ZZZZZZZZ');
  });

  it('accepts custom codes after normalization', () => {
    expect(parseBackupCode('  k7m2nx4p  ')).toBe('K7M2NX4P');
    expect(isValidBackupCode('TOO-SHORT')).toBe(false);
    expect(isValidBackupCode('O1234567')).toBe(false);
  });
});
