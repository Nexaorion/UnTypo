import { describe, expect, it } from 'vitest';
import { recorderAudioConstraints } from '../../src/recorder/device-selection';

describe('recorderAudioConstraints', () => {
  it('uses the Windows default input when automatic selection is active', () => {
    expect(recorderAudioConstraints()).toEqual({
      autoGainControl: true,
      echoCancellation: true,
      noiseSuppression: true,
    });
  });

  it('requests the selected microphone exactly', () => {
    expect(recorderAudioConstraints('microphone-1')).toMatchObject({
      deviceId: { exact: 'microphone-1' },
    });
  });
});
