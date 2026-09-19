import { randomInt } from 'node:crypto';
import {
  SYNC_BACKUP_CODE_GENERATED_LENGTH,
  SYNC_BACKUP_CODE_MAX_LENGTH,
  SYNC_BACKUP_CODE_MIN_LENGTH,
} from '../../shared/sync.js';

export const BACKUP_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

const alphabetSet = new Set(BACKUP_CODE_ALPHABET);

export const generateBackupCode = (length = SYNC_BACKUP_CODE_GENERATED_LENGTH): string => {
  if (
    !Number.isInteger(length) ||
    length < SYNC_BACKUP_CODE_MIN_LENGTH ||
    length > SYNC_BACKUP_CODE_MAX_LENGTH
  ) {
    throw new Error('Backup code length is invalid');
  }
  let code = '';
  for (let index = 0; index < length; index += 1) {
    code += BACKUP_CODE_ALPHABET[randomInt(BACKUP_CODE_ALPHABET.length)];
  }
  return code;
};

export const normalizeBackupCode = (value: string): string =>
  value.normalize('NFKC').trim().toUpperCase();

export const isValidBackupCode = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  const normalized = normalizeBackupCode(value);
  if (
    normalized.length < SYNC_BACKUP_CODE_MIN_LENGTH ||
    normalized.length > SYNC_BACKUP_CODE_MAX_LENGTH
  ) {
    return false;
  }
  return [...normalized].every((character) => alphabetSet.has(character));
};

export const parseBackupCode = (value: unknown): string => {
  if (!isValidBackupCode(value)) {
    throw new Error('Backup code is invalid');
  }
  return normalizeBackupCode(value);
};
