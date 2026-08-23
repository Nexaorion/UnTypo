import type {
  DictationIntent,
  SupportedLanguage,
  UserProfileContext,
} from '../core/providers/contracts.js';

export const IPC_CHANNELS = {
  clearHistory: 'client:clear-history',
  getSnapshot: 'client:get-snapshot',
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

export interface ClientProviderInput {
  id: string;
  providerId: string;
  secrets: Readonly<Record<string, string>>;
  values: Readonly<Record<string, ClientJsonValue>>;
}

export interface ClientProviderSummary {
  configuredSecretKeys: readonly string[];
  id: string;
  providerId: string;
  values: Readonly<Record<string, ClientJsonValue>>;
}

export interface ClientSettingsSnapshot {
  dictation: {
    activeProviderProfileId?: string;
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
    activeProviderProfileId?: string | null;
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
  createdAt: number;
  id: string;
  intent: DictationIntent;
  language: SupportedLanguage;
  outputText: string;
  providerId: string;
  rawTranscript?: string;
  scene?: string;
}

export interface ClientHistoryQuery {
  limit?: number;
  offset?: number;
}

export interface PingResponse {
  appName: string;
  platform: string;
  version: string;
}

export interface UntypoApi {
  clearHistory: () => Promise<number>;
  getSnapshot: () => Promise<ClientSnapshot>;
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
