import { DEFAULT_APPLICATION_WRITING_STYLES } from '../../src/shared/personalization.js';
import type {
  StoredClientConfig,
  StoredProviderProfile,
} from '../../src/main/storage/configuration.js';

export const createStoredProvider = (
  id: string,
  kind: 'speech' | 'text',
): StoredProviderProfile => ({
  id,
  kind,
  providerId: kind === 'speech' ? 'openai-compatible-speech' : 'openai-compatible-text',
  secrets: { apiKey: { ciphertext: 'dGVzdA==', scheme: 'memory-test-v1' } },
  values: {
    allowInsecurePrivateEndpoint: false,
    baseUrl: 'https://provider.example.test/v1',
    model: `model-${id}`,
    name: `Provider ${id}`,
    presetId: 'custom',
  },
});

export const createStoredConfig = (
  overrides: Partial<StoredClientConfig> = {},
): StoredClientConfig => ({
  version: 5,
  diagnostics: { automaticCollection: false, showErrorDialogs: false },
  general: { launchAtLogin: false, locale: 'en-US' },
  dictation: {
    defaultTargetLanguage: 'en-US',
    hotkeyAccelerator: 'Ctrl+Alt+Space',
    language: 'en-US',
  },
  dictionary: [],
  dictionaryLearning: { enabled: true },
  history: { enabled: true, retentionDays: 90 },
  personalization: {
    applicationStyles: { ...DEFAULT_APPLICATION_WRITING_STYLES },
    learningEnabled: true,
  },
  providers: [],
  telemetry: { enabled: false },
  updates: { autoCheck: false, autoDownload: false },
  ...overrides,
});
