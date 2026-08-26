import type {
  DictationIntent,
  SupportedLanguage,
  UserProfileContext,
} from '../core/providers/contracts.js';
import type {
  ClientDiagnosticExportRequest,
  ClientDiagnosticExportResult,
  ClientDiagnosticSnapshot,
  ClientRendererIssueInput,
} from './diagnostics.js';

export const IPC_CHANNELS = {
  acknowledgeDiagnostics: 'client:acknowledge-diagnostics',
  clearHistory: 'client:clear-history',
  copyText: 'client:copy-text',
  exportDiagnostics: 'client:export-diagnostics',
  getDiagnostics: 'client:get-diagnostics',
  getSnapshot: 'client:get-snapshot',
  getUsageStats: 'client:get-usage-stats',
  listMicrophones: 'client:list-microphones',
  listHistory: 'client:list-history',
  ping: 'app:ping',
  reportRendererIssue: 'client:report-renderer-issue',
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
    fastMode?: boolean;
    hotkeyAccelerator: string;
    intentClassificationModel?: string;
    language: SupportedLanguage;
    microphoneDeviceId?: string;
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
    fastMode?: boolean;
    hotkeyAccelerator?: string;
    intentClassificationModel?: string | null;
    language?: SupportedLanguage;
    microphoneDeviceId?: string | null;
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

export interface ClientMicrophoneDevice {
  deviceId: string;
  label: string;
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
  acknowledgeDiagnostics: (
    issueIds: readonly string[],
  ) => Promise<ClientDiagnosticSnapshot>;
  clearHistory: () => Promise<number>;
  copyText: (text: string) => Promise<void>;
  exportDiagnostics: (
    request: ClientDiagnosticExportRequest,
  ) => Promise<ClientDiagnosticExportResult>;
  getDiagnostics: () => Promise<ClientDiagnosticSnapshot>;
  getSnapshot: () => Promise<ClientSnapshot>;
  getUsageStats: () => Promise<ClientUsageStats>;
  listHistory: (
    query?: ClientHistoryQuery,
  ) => Promise<readonly ClientHistoryRecord[]>;
  listMicrophones: () => Promise<readonly ClientMicrophoneDevice[]>;
  onDiagnosticsChanged: (listener: () => void) => () => void;
  ping: () => Promise<PingResponse>;
  removeProvider: (profileId: string) => Promise<ClientSnapshot>;
  reportRendererIssue: (issue: ClientRendererIssueInput) => Promise<void>;
  setDictionary: (entries: readonly string[]) => Promise<ClientSnapshot>;
  setProfile: (profile?: UserProfileContext) => Promise<ClientSnapshot>;
  testProvider: (profileId: string) => Promise<{ ok: true }>;
  updateSettings: (update: ClientSettingsUpdate) => Promise<ClientSnapshot>;
  upsertProvider: (profile: ClientProviderInput) => Promise<ClientSnapshot>;
}
