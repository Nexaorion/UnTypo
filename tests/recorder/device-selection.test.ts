import { describe, expect, it } from 'vitest';
import {
  isMissingMicrophoneError,
  recorderAudioConstraints,
} from '../../src/recorder/device-selection';

describe('recorderAudioConstraints', () => {
  it('uses the Windows default input when automatic selection is active', () => {
    expect(recorderAudioConstraints()).toEqual({
      autoGainControl: true,
      echoCancellation: true,
      noiseSuppression: true,
    });
  });

  it('requires the explicitly selected microphone', () => {
    expect(recorderAudioConstraints('microphone-1')).toMatchObject({
      deviceId: { exact: 'microphone-1' },
    });
  });

  it('retries only errors that mean the selected device disappeared', () => {
    expect(isMissingMicrophoneError({ name: 'OverconstrainedError' })).toBe(
      true,
    );
    expect(isMissingMicrophoneError({ name: 'NotFoundError' })).toBe(true);
    expect(isMissingMicrophoneError({ name: 'NotAllowedError' })).toBe(false);
    expect(isMissingMicrophoneError({ name: 'NotReadableError' })).toBe(false);
  });
});
