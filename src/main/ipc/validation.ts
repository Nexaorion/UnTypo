import type { UserProfileContext } from '../../core/providers/contracts.js';
import type {
  ClientHistoryQuery,
  ClientJsonValue,
  ClientProviderInput,
  ClientSettingsUpdate,
} from '../../shared/ipc.js';

const profileIdPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/u;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const assertOnlyKeys = (
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void => {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new Error(`${label} contains an unsupported field`);
  }
};

const isLanguage = (value: unknown): value is 'en-US' | 'zh-CN' =>
  value === 'en-US' || value === 'zh-CN';

const isJsonValue = (value: unknown, depth = 0): value is ClientJsonValue => {
  if (depth > 10) return false;
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'string'
  ) {
    return true;
  }
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) {
    return value.every((entry) => isJsonValue(entry, depth + 1));
  }
  return (
    isRecord(value) &&
    Object.values(value).every((entry) => isJsonValue(entry, depth + 1))
  );
};

const optionalString = (
  value: unknown,
  label: string,
  maximumLength: number,
): string | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > maximumLength) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
};

export const parseSettingsUpdate = (value: unknown): ClientSettingsUpdate => {
  if (!isRecord(value)) throw new Error('Invalid settings update');
  assertOnlyKeys(value, ['dictation', 'general', 'history'], 'Settings update');
  const result: ClientSettingsUpdate = {};

  if (value.general !== undefined) {
    if (!isRecord(value.general)) throw new Error('Invalid general settings');
    assertOnlyKeys(
      value.general,
      ['launchAtLogin', 'locale'],
      'General settings',
    );
    const general: NonNullable<ClientSettingsUpdate['general']> = {};
    if (value.general.launchAtLogin !== undefined) {
      if (typeof value.general.launchAtLogin !== 'boolean')
        throw new Error('Invalid launch at login setting');
      general.launchAtLogin = value.general.launchAtLogin;
    }
    if (value.general.locale !== undefined) {
      if (!isLanguage(value.general.locale)) throw new Error('Invalid locale');
      general.locale = value.general.locale;
    }
    result.general = general;
  }

  if (value.dictation !== undefined) {
    if (!isRecord(value.dictation))
      throw new Error('Invalid dictation settings');
    assertOnlyKeys(
      value.dictation,
      [
        'activeProviderProfileId',
        'defaultTargetLanguage',
        'hotkeyAccelerator',
        'hotkeyMode',
        'language',
      ],
      'Dictation settings',
    );
    const dictation: NonNullable<ClientSettingsUpdate['dictation']> = {};
    if (value.dictation.activeProviderProfileId !== undefined) {
      if (
        value.dictation.activeProviderProfileId !== null &&
        (typeof value.dictation.activeProviderProfileId !== 'string' ||
          !profileIdPattern.test(value.dictation.activeProviderProfileId))
      ) {
        throw new Error('Invalid active provider profile');
      }
      dictation.activeProviderProfileId =
        value.dictation.activeProviderProfileId;
    }
    if (value.dictation.defaultTargetLanguage !== undefined) {
      if (!isLanguage(value.dictation.defaultTargetLanguage))
        throw new Error('Invalid target language');
      dictation.defaultTargetLanguage = value.dictation.defaultTargetLanguage;
    }
    if (value.dictation.hotkeyAccelerator !== undefined) {
      if (
        typeof value.dictation.hotkeyAccelerator !== 'string' ||
        value.dictation.hotkeyAccelerator.length === 0 ||
        value.dictation.hotkeyAccelerator.length > 128
      ) {
        throw new Error('Invalid hotkey accelerator');
      }
      dictation.hotkeyAccelerator = value.dictation.hotkeyAccelerator;
    }
    if (value.dictation.hotkeyMode !== undefined) {
      if (
        value.dictation.hotkeyMode !== 'push-to-talk' &&
        value.dictation.hotkeyMode !== 'toggle'
      ) {
        throw new Error('Invalid hotkey mode');
      }
      dictation.hotkeyMode = value.dictation.hotkeyMode;
    }
    if (value.dictation.language !== undefined) {
      if (!isLanguage(value.dictation.language))
        throw new Error('Invalid dictation language');
      dictation.language = value.dictation.language;
    }
    result.dictation = dictation;
  }

  if (value.history !== undefined) {
    if (!isRecord(value.history)) throw new Error('Invalid history settings');
    assertOnlyKeys(
      value.history,
      ['enabled', 'retentionDays'],
      'History settings',
    );
    const history: NonNullable<ClientSettingsUpdate['history']> = {};
    if (value.history.enabled !== undefined) {
      if (typeof value.history.enabled !== 'boolean')
        throw new Error('Invalid history enabled setting');
      history.enabled = value.history.enabled;
    }
    if (value.history.retentionDays !== undefined) {
      const retentionDays = value.history.retentionDays;
      if (
        typeof retentionDays !== 'number' ||
        !Number.isInteger(retentionDays) ||
        retentionDays < 0 ||
        retentionDays > 3_650
      ) {
        throw new Error('Invalid history retention');
      }
      history.retentionDays = retentionDays;
    }
    result.history = history;
  }

  return result;
};

export const parseDictionary = (value: unknown): readonly string[] => {
  if (!Array.isArray(value) || value.length > 1_000) {
    throw new Error('Invalid dictionary');
  }
  const entries: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.length > 128) {
      throw new Error('Invalid dictionary');
    }
    entries.push(entry);
  }
  return entries;
};

export const parseProfile = (
  value: unknown,
): UserProfileContext | undefined => {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) throw new Error('Invalid personal profile');
  assertOnlyKeys(
    value,
    ['displayName', 'preferredName', 'signature'],
    'Personal profile',
  );
  const displayName = optionalString(value.displayName, 'display name', 200);
  const preferredName = optionalString(
    value.preferredName,
    'preferred name',
    200,
  );
  const signature = optionalString(value.signature, 'signature', 1_000);
  return {
    ...(displayName === undefined ? {} : { displayName }),
    ...(preferredName === undefined ? {} : { preferredName }),
    ...(signature === undefined ? {} : { signature }),
  };
};

export const parseProviderInput = (value: unknown): ClientProviderInput => {
  if (!isRecord(value)) throw new Error('Invalid provider profile');
  assertOnlyKeys(
    value,
    ['id', 'providerId', 'secrets', 'values'],
    'Provider profile',
  );
  if (
    typeof value.id !== 'string' ||
    !profileIdPattern.test(value.id) ||
    value.providerId !== 'openai' ||
    !isRecord(value.secrets) ||
    !isRecord(value.values)
  ) {
    throw new Error('Invalid provider profile');
  }
  assertOnlyKeys(value.secrets, ['apiKey'], 'Provider secrets');
  assertOnlyKeys(
    value.values,
    [
      'allowInsecurePrivateEndpoint',
      'baseUrl',
      'textModel',
      'transcriptionModel',
    ],
    'Provider values',
  );
  if (
    typeof value.secrets.apiKey !== 'string' ||
    value.secrets.apiKey.length === 0 ||
    value.secrets.apiKey.length > 16_384 ||
    typeof value.values.textModel !== 'string' ||
    value.values.textModel.length === 0 ||
    value.values.textModel.length > 200 ||
    typeof value.values.transcriptionModel !== 'string' ||
    value.values.transcriptionModel.length === 0 ||
    value.values.transcriptionModel.length > 200 ||
    (value.values.baseUrl !== undefined &&
      (typeof value.values.baseUrl !== 'string' ||
        value.values.baseUrl.length > 2_048)) ||
    (value.values.allowInsecurePrivateEndpoint !== undefined &&
      typeof value.values.allowInsecurePrivateEndpoint !== 'boolean') ||
    !Object.values(value.values).every((entry) => isJsonValue(entry))
  ) {
    throw new Error('Invalid OpenAI provider configuration');
  }
  return value as unknown as ClientProviderInput;
};

export const parseProfileId = (value: unknown): string => {
  if (typeof value !== 'string' || !profileIdPattern.test(value)) {
    throw new Error('Invalid provider profile id');
  }
  return value;
};

export const parseHistoryQuery = (value: unknown): ClientHistoryQuery => {
  if (value === undefined) return {};
  if (!isRecord(value)) throw new Error('Invalid history query');
  assertOnlyKeys(value, ['limit', 'offset'], 'History query');
  const limit = value.limit;
  const offset = value.offset;
  if (limit !== undefined) {
    if (
      typeof limit !== 'number' ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 500
    ) {
      throw new Error('Invalid history query');
    }
  }
  if (offset !== undefined) {
    if (typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0) {
      throw new Error('Invalid history query');
    }
  }
  return {
    ...(typeof limit === 'number' ? { limit } : {}),
    ...(typeof offset === 'number' ? { offset } : {}),
  };
};
