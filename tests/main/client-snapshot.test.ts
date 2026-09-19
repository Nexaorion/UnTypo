import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const systemPreferences = vi.hoisted(() => ({
  getMediaAccessStatus: vi.fn(() => 'granted'),
  isTrustedAccessibilityClient: vi.fn(() => true),
}));

vi.mock('electron', () => ({ systemPreferences }));

import { buildClientSnapshot } from '../../src/main/runtime/client-snapshot.js';
import type { ClientSnapshot } from '../../src/shared/ipc.js';
import type { ConfigurationService } from '../../src/main/storage/configuration.js';
import type { WritingPreferenceLearningService } from '../../src/main/personalization/learning.js';
import type { SyncService } from '../../src/main/sync/sync-service.js';
import type { ApplicationUpdateService } from '../../src/main/update/application-update-service.js';
import { createStoredConfig, createStoredProvider } from './fixtures.js';

const learningSnapshot = {
  preferences: [{ id: 'preference-1' }],
  suggestions: [{ id: 'suggestion-1' }],
};

const createSnapshot = async (
  overrides?: Partial<Parameters<typeof buildClientSnapshot>[0]>,
): Promise<ClientSnapshot> => {
  const configuration = {
    getProfile: vi.fn(() => undefined),
    load: vi.fn(() =>
      createStoredConfig({
        dictation: {
          activeSpeechProviderProfileId: 'speech-1',
          defaultTargetLanguage: 'en-US',
          fastMode: true,
          hotkeyAccelerator: 'Ctrl+Alt+Space',
          language: 'zh-CN',
          microphoneDeviceId: 'device-1',
          microphoneDeviceLabel: 'Microphone',
        },
        providers: [createStoredProvider('speech-1', 'speech')],
      }),
    ),
  } as unknown as ConfigurationService;
  const preferenceLearning = {
    snapshot: vi.fn(() => learningSnapshot),
  } as unknown as WritingPreferenceLearningService;
  const sync = {
    snapshot: vi.fn(() => ({ enabled: false })),
  } as unknown as SyncService;
  const updates = {
    snapshot: vi.fn(() => ({ state: 'idle' })),
  } as unknown as ApplicationUpdateService;
  return buildClientSnapshot({
    configuration,
    preferenceLearning,
    sync,
    updates,
    ...overrides,
  });
};

describe('buildClientSnapshot', () => {
  beforeEach(() => {
    systemPreferences.getMediaAccessStatus.mockReset();
    systemPreferences.getMediaAccessStatus.mockReturnValue('granted');
    systemPreferences.isTrustedAccessibilityClient.mockReset();
    systemPreferences.isTrustedAccessibilityClient.mockReturnValue(true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('assembles the client snapshot from all backing services', async () => {
    const snapshot = await createSnapshot();

    expect(snapshot.settings.dictation.hotkeyAccelerator).toBe(
      'Ctrl+Alt+Space',
    );
    expect(snapshot.settings.dictation.fastMode).toBe(true);
    expect(snapshot.settings.dictation.microphoneDeviceId).toBe('device-1');
    expect(snapshot.settings.general.locale).toBe('en-US');
    expect(snapshot.personalization.preferences).toEqual(
      learningSnapshot.preferences,
    );
    expect(snapshot.personalization.suggestions).toEqual(
      learningSnapshot.suggestions,
    );
    expect(snapshot.providers).toHaveLength(1);
    expect(snapshot.providers[0]).toMatchObject({
      configuredSecretKeys: ['apiKey'],
      id: 'speech-1',
      kind: 'speech',
    });
    expect(snapshot.sync).toEqual({ enabled: false });
    expect(snapshot.update).toEqual({ state: 'idle' });
  });

  

  it('includes current permission statuses on macOS', async () => {
    vi.stubGlobal('process', { ...process, platform: 'darwin' });
    systemPreferences.getMediaAccessStatus.mockReturnValue('not-determined');
    systemPreferences.isTrustedAccessibilityClient.mockReturnValue(false);

    const snapshot = await createSnapshot();

    expect(snapshot.permissions).toEqual({
      accessibility: 'denied',
      microphone: 'not-determined',
    });
    expect(systemPreferences.getMediaAccessStatus).toHaveBeenCalledWith(
      'microphone',
    );
    expect(systemPreferences.isTrustedAccessibilityClient).toHaveBeenCalledWith(
      false,
    );
  });

  it('fails when the configuration cannot be loaded', async () => {
    const configuration = {
      getProfile: vi.fn(() => undefined),
      load: vi.fn(() => {
        throw new Error('config unavailable');
      }),
    } as unknown as ConfigurationService;

    await expect(createSnapshot({ configuration })).rejects.toThrow(
      'config unavailable',
    );
  });
});
