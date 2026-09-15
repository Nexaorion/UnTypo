import type { SyncBackupInfo } from '../../shared/sync.js';

const BACKUP_FILE_PATTERN = /^untypo-(\d{13})-([A-Za-z0-9_-]+)\.untypo$/u;

export const normalizeBackupDeviceName = (value: string): string => {
  const name = [...value]
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint > 31 && codePoint !== 127;
    })
    .join('')
    .trim()
    .slice(0, 128);
  return name || 'Unknown device';
};

export const createBackupFileName = (
  createdAt: number,
  deviceName: string,
): string =>
  `untypo-${createdAt}-${Buffer.from(normalizeBackupDeviceName(deviceName), 'utf8').toString('base64url')}.untypo`;

export const parseBackupFileName = (
  name: string,
): Pick<SyncBackupInfo, 'createdAt' | 'deviceName'> | undefined => {
  const match = BACKUP_FILE_PATTERN.exec(name);
  if (!match) return undefined;
  const createdAt = Number(match[1]);
  const encodedName = match[2];
  if (!Number.isSafeInteger(createdAt) || createdAt < 0 || !encodedName) {
    return undefined;
  }
  try {
    const deviceName = Buffer.from(encodedName, 'base64url').toString('utf8');
    if (
      !deviceName ||
      deviceName.length > 128 ||
      normalizeBackupDeviceName(deviceName) !== deviceName ||
      Buffer.from(deviceName, 'utf8').toString('base64url') !== encodedName
    ) {
      return undefined;
    }
    return { createdAt, deviceName };
  } catch {
    return undefined;
  }
};
