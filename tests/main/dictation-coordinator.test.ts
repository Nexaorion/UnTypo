import { describe, expect, it, vi } from 'vitest';
import type { AudioPayload } from '../../src/core/providers/contracts';
import { MockDictationProvider } from '../../src/core/providers/mock-provider';
import { ProviderRegistry } from '../../src/core/providers/registry';
import { DictationCoordinator } from '../../src/main/dictation/coordinator';
import { NativeHotkeyAction } from '../../src/main/native/protocol';
import type { NativeTargetSnapshot } from '../../src/main/native/protocol';

const target: NativeTargetSnapshot = {
  editable: true,
  higherIntegrity: false,
  processId: 42,
  windowHandle: '4660',
};

const audio: AudioPayload = {
  bytes: new Uint8Array([1, 2, 3]),
  channels: 1,
  durationMs: 500,
  mimeType: 'audio/webm',
  sampleRateHz: 48_000,
};

const createCoordinator = (injected: boolean) => {
  const providers = new ProviderRegistry();
  providers.register(
    new MockDictationProvider({
      polishedText: 'Final mock result',
      transcript: 'raw mock result',
    }),
  );
  const show = vi.fn();
  const record = vi.fn();
  const start = vi.fn(() => Promise.resolve('recording-session'));
  const stop = vi.fn(() =>
    Promise.resolve({
      audio,
      sessionId: 'recording-session',
      target,
    }),
  );
  const inject = vi.fn(() => Promise.resolve({ injected }));
  const coordinator = new DictationCoordinator({
    fallback: { show },
    getContext: () => ({
      history: { enabled: true, retentionDays: 30 },
      modelName: 'whisper-1',
      options: {
        defaultTargetLanguage: 'en-US',
        dictionary: [],
        language: 'en-US',
      },
      providerId: 'mock',
      uiLanguage: 'en-US',
    }),
    history: { record },
    injection: { inject },
    native: { captureTarget: () => Promise.resolve(target) },
    providers,
    recorder: { start, stop },
  });
  return { coordinator, inject, record, show, start, stop };
};

describe('DictationCoordinator', () => {
  it('runs hotkey, mock provider, original target, and history end to end', async () => {
    const runtime = createCoordinator(true);

    await runtime.coordinator.handleHotkey(NativeHotkeyAction.Start);
    expect(runtime.coordinator.state).toBe('recording');
    await runtime.coordinator.handleHotkey(NativeHotkeyAction.Stop);

    expect(runtime.start).toHaveBeenCalledWith({
      processId: 42,
      windowHandle: '4660',
    });
    expect(runtime.inject).toHaveBeenCalledWith('Final mock result', target);
    expect(runtime.show).not.toHaveBeenCalled();
    expect(runtime.record).toHaveBeenCalledWith(
      expect.objectContaining({
        audioDurationMs: 500,
        intent: 'transcription',
        modelName: 'whisper-1',
        outputText: 'Final mock result',
        rawTranscript: 'raw mock result',
      }),
      { enabled: true, retentionDays: 30 },
    );
    expect(runtime.coordinator.state).toBe('idle');
  });

  it('shows the fallback while keeping the result available on paste failure', async () => {
    const runtime = createCoordinator(false);

    await runtime.coordinator.handleHotkey(NativeHotkeyAction.Toggle);
    await runtime.coordinator.handleHotkey(NativeHotkeyAction.Toggle);

    expect(runtime.show).toHaveBeenCalledWith(
      expect.objectContaining({ outputText: 'Final mock result' }),
    );
    expect(runtime.coordinator.state).toBe('idle');
  });
});
