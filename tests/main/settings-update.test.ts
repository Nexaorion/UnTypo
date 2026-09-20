import { describe, expect, it } from 'vitest';

import { mergeSettingsUpdate } from '../../src/main/runtime/settings-update.js';
import { createStoredConfig } from './fixtures.js';

describe('mergeSettingsUpdate', () => {
  it('merges plain settings groups over the stored configuration', () => {
    const next = mergeSettingsUpdate(createStoredConfig(), {
      general: { locale: 'zh-CN' },
      history: { enabled: false, retentionDays: 7 },
    });

    expect(next.general.locale).toBe('zh-CN');
    expect(next.general.launchAtLogin).toBe(false);
    expect(next.history).toEqual({ enabled: false, retentionDays: 7 });
    expect(next.dictation.hotkeyAccelerator).toBe('Ctrl+Alt+Space');
  });

  it('merges the telemetry switch without touching other groups', () => {
    const next = mergeSettingsUpdate(createStoredConfig(), {
      telemetry: { enabled: true },
    });

    expect(next.telemetry).toEqual({ enabled: true });
    expect(next.diagnostics.automaticCollection).toBe(false);
    expect(next.updates).toEqual({ autoCheck: false, autoDownload: false });
  });

  it('keeps optional provider ids only when explicitly provided', () => {
    const base = createStoredConfig({
      dictation: {
        activeSpeechProviderProfileId: 'speech-1',
        activeTextProviderProfileId: 'text-1',
        defaultTargetLanguage: 'en-US',
        hotkeyAccelerator: 'Ctrl+Alt+Space',
        language: 'en-US',
      },
    });

    const untouched = mergeSettingsUpdate(base, {});
    expect(untouched.dictation.activeSpeechProviderProfileId).toBe('speech-1');
    expect(untouched.dictation.activeTextProviderProfileId).toBe('text-1');

    const replaced = mergeSettingsUpdate(base, {
      dictation: {
        activeSpeechProviderProfileId: 'speech-2',
        activeTextProviderProfileId: 'text-2',
      },
    });
    expect(replaced.dictation.activeSpeechProviderProfileId).toBe('speech-2');
    expect(replaced.dictation.activeTextProviderProfileId).toBe('text-2');

    const cleared = mergeSettingsUpdate(base, {
      dictation: {
        activeSpeechProviderProfileId: null,
        activeTextProviderProfileId: null,
      },
    });
    expect(cleared.dictation.activeSpeechProviderProfileId).toBeUndefined();
    expect(cleared.dictation.activeTextProviderProfileId).toBeUndefined();
  });

  it('keeps the microphone label consistent with its device id', () => {
    const next = mergeSettingsUpdate(createStoredConfig(), {
      dictation: {
        microphoneDeviceId: 'device-2',
        microphoneDeviceLabel: 'Headset',
      },
    });
    expect(next.dictation.microphoneDeviceId).toBe('device-2');
    expect(next.dictation.microphoneDeviceLabel).toBe('Headset');

    const relabeled = mergeSettingsUpdate(createStoredConfig(), {
      dictation: { microphoneDeviceLabel: 'Relabeled' },
    });
    expect(relabeled.dictation.microphoneDeviceLabel).toBe('Relabeled');

    const unlabeled = mergeSettingsUpdate(createStoredConfig(), {
      dictation: { microphoneDeviceLabel: null },
    });
    expect(unlabeled.dictation.microphoneDeviceLabel).toBeUndefined();
  });

  it('drops the microphone selection entirely when its id is cleared', () => {
    const base = createStoredConfig({
      dictation: {
        defaultTargetLanguage: 'en-US',
        hotkeyAccelerator: 'Ctrl+Alt+Space',
        language: 'en-US',
        microphoneDeviceId: 'device-2',
        microphoneDeviceLabel: 'Headset',
      },
    });

    const next = mergeSettingsUpdate(base, {
      dictation: { microphoneDeviceId: null },
    });

    expect(next.dictation.microphoneDeviceId).toBeUndefined();
    expect(next.dictation.microphoneDeviceLabel).toBeUndefined();
  });
});
