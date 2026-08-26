import type { UserProfileContext } from '../../core/providers/contracts.js';
import type {
  ClientHistoryQuery,
  ClientProviderInput,
  ClientSettingsUpdate,
  ModelProviderId,
  ModelProviderKind,
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
        'activeSpeechProviderProfileId',
        'activeTextProviderProfileId',
        'defaultTargetLanguage',
        'hotkeyAccelerator',
        'language',
        'microphoneDeviceId',
      ],
      'Dictation settings',
    );
    const dictation: NonNullable<ClientSettingsUpdate['dictation']> = {};
    if (value.dictation.activeSpeechProviderProfileId !== undefined) {
      if (
        value.dictation.activeSpeechProviderProfileId !== null &&
        (typeof value.dictation.activeSpeechProviderProfileId !== 'string' ||
          !profileIdPattern.test(value.dictation.activeSpeechProviderProfileId))
      ) {
        throw new Error('Invalid active speech provider profile');
      }
      dictation.activeSpeechProviderProfileId =
        value.dictation.activeSpeechProviderProfileId;
    }
    if (value.dictation.activeTextProviderProfileId !== undefined) {
      if (
        value.dictation.activeTextProviderProfileId !== null &&
        (typeof value.dictation.activeTextProviderProfileId !== 'string' ||
          !profileIdPattern.test(value.dictation.activeTextProviderProfileId))
      ) {
        throw new Error('Invalid active text provider profile');
      }
      dictation.activeTextProviderProfileId =
        value.dictation.activeTextProviderProfileId;
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
    if (value.dictation.microphoneDeviceId !== undefined) {
      if (
        value.dictation.microphoneDeviceId !== null &&
        (typeof value.dictation.microphoneDeviceId !== 'string' ||
          value.dictation.microphoneDeviceId.length === 0 ||
          value.dictation.microphoneDeviceId.length > 512)
      ) {
        throw new Error('Invalid microphone device');
      }
      dictation.microphoneDeviceId = value.dictation.microphoneDeviceId;
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
    ['id', 'kind', 'providerId', 'secrets', 'values'],
    'Provider profile',
  );
  if (
    typeof value.id !== 'string' ||
    !profileIdPattern.test(value.id) ||
    (value.kind !== 'speech' && value.kind !== 'text') ||
    !isRecord(value.secrets) ||
    !isRecord(value.values)
  ) {
    throw new Error('Invalid provider profile');
  }
  const providerKinds: Readonly<Record<ModelProviderId, ModelProviderKind>> = {
    'aliyun-bailian-speech': 'speech',
    'anthropic-text': 'text',
    'openai-compatible-speech': 'speech',
    'openai-compatible-text': 'text',
    'openai-responses-text': 'text',
  };
  if (
    typeof value.providerId !== 'string' ||
    !(value.providerId in providerKinds) ||
    providerKinds[value.providerId as ModelProviderId] !== value.kind
  ) {
    throw new Error('Provider kind does not match provider id');
  }
  assertOnlyKeys(value.secrets, ['apiKey'], 'Provider secrets');
  assertOnlyKeys(
    value.values,
    ['allowInsecurePrivateEndpoint', 'baseUrl', 'model', 'name', 'presetId'],
    'Provider values',
  );
  if (
    (value.secrets.apiKey !== undefined &&
      (typeof value.secrets.apiKey !== 'string' ||
        value.secrets.apiKey.length > 16_384)) ||
    typeof value.values.name !== 'string' ||
    value.values.name.trim().length === 0 ||
    value.values.name.length > 200 ||
    typeof value.values.presetId !== 'string' ||
    value.values.presetId.trim().length === 0 ||
    value.values.presetId.length > 100 ||
    typeof value.values.model !== 'string' ||
    value.values.model.trim().length === 0 ||
    value.values.model.length > 200 ||
    typeof value.values.baseUrl !== 'string' ||
    value.values.baseUrl.trim().length === 0 ||
    value.values.baseUrl.length > 2_048 ||
    (value.values.allowInsecurePrivateEndpoint !== undefined &&
      typeof value.values.allowInsecurePrivateEndpoint !== 'boolean')
  ) {
    throw new Error('Invalid provider configuration');
  }
  const apiKey =
    typeof value.secrets.apiKey === 'string' &&
    value.secrets.apiKey.trim().length > 0
      ? value.secrets.apiKey
      : undefined;
  return {
    id: value.id,
    kind: value.kind,
    providerId: value.providerId as ModelProviderId,
    secrets: apiKey ? { apiKey } : {},
    values: {
      name: value.values.name,
      presetId: value.values.presetId,
      model: value.values.model,
      baseUrl: value.values.baseUrl,
      ...(typeof value.values.allowInsecurePrivateEndpoint === 'boolean'
        ? {
            allowInsecurePrivateEndpoint:
              value.values.allowInsecurePrivateEndpoint,
          }
        : {}),
    },
  };
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
