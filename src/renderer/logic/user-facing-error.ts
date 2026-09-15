import type { Translate } from '../i18n/context.js';

const errorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message.trim();
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    return error.message.trim();
  }
  return typeof error === 'string' ? error.trim() : '';
};

export const unwrapIpcErrorMessage = (error: unknown): string => {
  let message = errorMessage(error);
  const ipcPrefix = /^Error invoking remote method ['"][^'"]+['"]:\s*/iu;
  message = message.replace(ipcPrefix, '');
  while (/^Error:\s*/iu.test(message)) {
    message = message.replace(/^Error:\s*/iu, '');
  }
  return message.trim();
};

export const describeUserFacingError = (
  error: unknown,
  t: Translate,
): string => {
  const message = unwrapIpcErrorMessage(error);
  const normalized = message.toLowerCase();

  if (normalized.includes('hotkey_conflict')) return t('error.hotkeyConflict');
  if (normalized.includes('hotkey_unavailable'))
    return t('error.hotkeyUnavailable');
  if (/backup code (?:length )?is invalid/u.test(normalized))
    return t('error.invalidBackupCode');
  if (normalized.includes('backup code is not configured'))
    return t('error.backupCodeMissing');
  if (
    normalized.includes('cloud storage is not configured') ||
    normalized.includes('storage is incomplete') ||
    normalized.includes('cloud sync is disabled')
  ) {
    return t('error.syncNotConfigured');
  }
  if (normalized.includes('remote backup does not exist'))
    return t('error.backupMissing');
  if (
    normalized.includes('remote path is invalid') ||
    normalized.includes('remote backup path is invalid') ||
    normalized.includes('remote file name is invalid')
  ) {
    return t('error.remotePathInvalid');
  }
  if (
    normalized.includes('remote file is empty') ||
    normalized.includes('remote file could not be read') ||
    normalized.includes('invalid history')
  ) {
    return t('error.backupUnreadable');
  }
  if (
    normalized.includes('not a valid url') ||
    normalized.includes('invalid url') ||
    normalized.includes('endpoint must use') ||
    normalized.includes('embedded credentials')
  ) {
    return t('error.invalidServerAddress');
  }
  if (
    normalized.includes('provider profile does not exist') ||
    normalized.includes('provider profile cannot change kind') ||
    normalized.includes('invalid provider profile')
  ) {
    return t('error.providerConfiguration');
  }
  if (
    normalized.includes('api key') ||
    normalized.includes('unauthorized') ||
    /(?:^|\s)401(?:\s|$)/u.test(normalized)
  ) {
    return t('error.serviceAuthentication');
  }
  if (
    normalized.includes('forbidden') ||
    normalized.includes('access denied') ||
    /(?:^|\s)403(?:\s|$)/u.test(normalized)
  ) {
    return t('error.permissionDenied');
  }
  if (
    normalized.includes('rate limit') ||
    normalized.includes('too many requests') ||
    normalized.includes('quota') ||
    /(?:^|\s)429(?:\s|$)/u.test(normalized)
  ) {
    return t('error.serviceLimit');
  }
  if (
    normalized.includes('timeout') ||
    normalized.includes('timed out') ||
    normalized.includes('aborterror')
  ) {
    return t('error.requestTimeout');
  }
  if (
    normalized.includes('failed to fetch') ||
    normalized.includes('fetch failed') ||
    normalized.includes('network') ||
    /econn(?:refused|reset)|enotfound|enetunreach/u.test(normalized)
  ) {
    return t('error.networkUnavailable');
  }
  if (
    normalized.includes('notallowederror') ||
    normalized.includes('permission denied')
  ) {
    return t('error.devicePermission');
  }
  if (
    normalized.includes('notfounderror') ||
    normalized.includes('overconstrainederror') ||
    normalized.includes('unable to list microphones') ||
    normalized.includes('microphone failed')
  ) {
    return t('error.microphoneUnavailable');
  }
  if (normalized.includes('operating system encryption is unavailable'))
    return t('error.secureStorageUnavailable');

  return t('error.tryAgain');
};
