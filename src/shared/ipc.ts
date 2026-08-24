import type {
  DictationIntent,
  SupportedLanguage,
  UserProfileContext,
} from '../core/providers/contracts.js';

export const IPC_CHANNELS = {
  clearHistory: 'client:clear-history',
  getSnapshot: 'client:get-snapshot',
  getUsageStats: 'client:get-usage-stats',
  listHistory: 'client:list-history',
  ping: 'app:ping',
  removeProvider: 'client:remove-provider',
  setDictionary: 'client:set-dictionary',
  setProfile: 'client:set-profile',
  testProvider: 'client:test-provider',
  updateSettings: 'client:update-settings',
  upsertProvider: 'client:upsert-provider',
} as const;

export type ClientJsonPrimitive = boolean | number | string | null;
export type ClientJsonValue =
  | ClientJsonPrimitive
  | readonly ClientJsonValue[]
  | { readonly [key: string]: ClientJsonValue };

export type ModelProviderKind = 'speech' | 'text';

export type ModelProviderId =
  | 'aliyun-bailian-speech'
  | 'anthropic-text'
  | 'openai-compatible-speech'
  | 'openai-compatible-text'
  | 'openai-responses-text';

export interface ClientProviderValues {
  allowInsecurePrivateEndpoint?: boolean;
  baseUrl: string;
  model: string;
  name: string;
  presetId: string;
}

export interface ClientProviderInput {
  id: string;
  kind: ModelProviderKind;
  providerId: ModelProviderId;
  secrets: Readonly<Record<string, string>>;
  values: Readonly<ClientProviderValues>;
}

export interface ClientProviderSummary {
  configuredSecretKeys: readonly string[];
  id: string;
  kind: ModelProviderKind;
  providerId: ModelProviderId;
  values: Readonly<ClientProviderValues>;
}

export interface ClientSettingsSnapshot {
  dictation: {
    activeSpeechProviderProfileId?: string;
    activeTextProviderProfileId?: string;
    defaultTargetLanguage: SupportedLanguage;
    hotkeyAccelerator: string;
    hotkeyMode: 'push-to-talk' | 'toggle';
    language: SupportedLanguage;
  };
  general: {
    launchAtLogin: boolean;
    locale: SupportedLanguage;
  };
  history: {
    enabled: boolean;
    retentionDays: number;
  };
}

export interface ClientSettingsUpdate {
  dictation?: {
    activeSpeechProviderProfileId?: string | null;
    activeTextProviderProfileId?: string | null;
    defaultTargetLanguage?: SupportedLanguage;
    hotkeyAccelerator?: string;
    hotkeyMode?: 'push-to-talk' | 'toggle';
    language?: SupportedLanguage;
  };
  general?: {
    launchAtLogin?: boolean;
    locale?: SupportedLanguage;
  };
  history?: {
    enabled?: boolean;
    retentionDays?: number;
  };
}

export interface ClientSnapshot {
  dictionary: readonly string[];
  profile?: UserProfileContext;
  providers: readonly ClientProviderSummary[];
  settings: ClientSettingsSnapshot;
}

export interface ClientHistoryRecord {
  audioDurationMs?: number;
  createdAt: number;
  id: string;
  intent: DictationIntent;
  language: SupportedLanguage;
  modelName?: string;
  outputText: string;
  providerId: string;
  rawTranscript?: string;
  scene?: string;
}

export interface ClientUsageStats {
  outputCharacters: number;
  mostUsedModel?: string;
  transcriptionDurationMs: number;
  usageCount: number;
}

export interface ClientHistoryQuery {
  limit?: number;
  offset?: number;
}

export interface PingResponse {
  appName: string;
  platform: string;
  userName: string;
  version: string;
}

export interface UntypoApi {
  clearHistory: () => Promise<number>;
  getSnapshot: () => Promise<ClientSnapshot>;
  getUsageStats: () => Promise<ClientUsageStats>;
  listHistory: (
    query?: ClientHistoryQuery,
  ) => Promise<readonly ClientHistoryRecord[]>;
  ping: () => Promise<PingResponse>;
  removeProvider: (profileId: string) => Promise<ClientSnapshot>;
  setDictionary: (entries: readonly string[]) => Promise<ClientSnapshot>;
  setProfile: (profile?: UserProfileContext) => Promise<ClientSnapshot>;
  testProvider: (profileId: string) => Promise<{ ok: true }>;
  updateSettings: (update: ClientSettingsUpdate) => Promise<ClientSnapshot>;
  upsertProvider: (profile: ClientProviderInput) => Promise<ClientSnapshot>;
}
