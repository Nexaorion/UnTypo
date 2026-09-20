import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ net: {} }));

import { ProviderActivationService } from '../../src/main/providers/provider-activation.js';
import type {
  ConfigurationService,
  ProviderProfile,
} from '../../src/main/storage/config-store.js';
import type { DiagnosticCollector } from '../../src/main/diagnostics/collector.js';
import { createStoredConfig } from './fixtures.js';

const speechProfile: ProviderProfile = {
  id: 'speech-1',
  kind: 'speech',
  providerId: 'openai-compatible-speech',
  secrets: { apiKey: 'sk-speech' },
  values: {
    allowInsecurePrivateEndpoint: false,
    baseUrl: 'https://provider.example.test/v1',
    model: 'whisper-1',
    name: 'Speech',
    presetId: 'custom',
  },
};

const textProfile: ProviderProfile = {
  id: 'text-1',
  kind: 'text',
  providerId: 'openai-compatible-text',
  secrets: { apiKey: 'sk-text' },
  values: {
    allowInsecurePrivateEndpoint: false,
    baseUrl: 'https://provider.example.test/v1',
    model: 'gpt-test',
    name: 'Text',
    presetId: 'custom',
  },
};

const createService = (profiles: Record<string, ProviderProfile | undefined>) => {
  const configuration = {
    getProvider: vi.fn((id: string) => profiles[id]),
  } as unknown as ConfigurationService;
  const createLoggedFetch = vi.fn(() => fetch);
  const diagnostics = { createLoggedFetch } as unknown as DiagnosticCollector;
  const service = new ProviderActivationService({
    configuration,
    diagnostics,
  });
  return { configuration, createLoggedFetch, service };
};

describe('ProviderActivationService', () => {
  it('activates the configured speech and text providers', async () => {
    const { service } = createService({
      'speech-1': speechProfile,
      'text-1': textProfile,
    });

    await service.activate(
      createStoredConfig({
        dictation: {
          activeSpeechProviderProfileId: 'speech-1',
          activeTextProviderProfileId: 'text-1',
          defaultTargetLanguage: 'en-US',
          hotkeyAccelerator: 'Ctrl+Alt+Space',
          language: 'en-US',
        },
        providers: [],
      }),
    );

    expect(service.speechProviderId).toBe('speech-1');
    expect(service.textProviderId).toBe('text-1');
    expect(service.speechProviders.get('speech-1')).toBeDefined();
    expect(service.textProviders.get('text-1')).toBeDefined();
    expect(service.activeTextProvider).toBeDefined();
  });

  it('rejects activation when the active speech profile is missing', async () => {
    const { service } = createService({});

    await expect(
      service.activate(
        createStoredConfig({
          dictation: {
            activeSpeechProviderProfileId: 'missing',
            defaultTargetLanguage: 'en-US',
            hotkeyAccelerator: 'Ctrl+Alt+Space',
            language: 'en-US',
          },
        }),
      ),
    ).rejects.toThrow('Active speech provider profile does not exist');
  });

  it('clears previously active providers on reactivation', async () => {
    const { service } = createService({ 'speech-1': speechProfile });

    await service.activate(
      createStoredConfig({
        dictation: {
          activeSpeechProviderProfileId: 'speech-1',
          defaultTargetLanguage: 'en-US',
          hotkeyAccelerator: 'Ctrl+Alt+Space',
          language: 'en-US',
        },
      }),
    );
    await service.activate(createStoredConfig());

    expect(service.speechProviderId).toBeUndefined();
    expect(service.speechProviders.get('speech-1')).toBeUndefined();
    expect(service.activeTextProvider).toBeUndefined();
  });

  it('routes provider fetches through the logged fetch factory', () => {
    const { createLoggedFetch, service } = createService({});

    service.providerFetch(speechProfile);

    expect(createLoggedFetch).toHaveBeenCalledWith({
      model: 'whisper-1',
      profileId: 'speech-1',
      providerId: 'openai-compatible-speech',
    });
  });
});
