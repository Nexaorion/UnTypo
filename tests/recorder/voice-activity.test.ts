import { describe, expect, it } from 'vitest';
import { VoiceActivityDetector } from '../../src/recorder/voice-activity';

const sampleRateHz = 48_000;
const frameDurationMs = 80;

const samplesAtLevel = (level: number): Float32Array<ArrayBuffer> =>
  new Float32Array(512).fill(level);

const spectrum = (voiceLike: boolean): Float32Array<ArrayBuffer> => {
  const values = new Float32Array(1_024).fill(-100);
  const binWidthHz = sampleRateHz / (values.length * 2);
  const end = Math.floor(8_000 / binWidthHz);
  const speechEnd = Math.floor(4_000 / binWidthHz);
  for (let index = Math.ceil(80 / binWidthHz); index <= end; index += 1) {
    values[index] = !voiceLike || index <= speechEnd ? -20 : -60;
  }
  return values;
};

describe('VoiceActivityDetector', () => {
  it('does not detect silence or a broadband background noise burst as speech', () => {
    const detector = new VoiceActivityDetector();
    const silent = samplesAtLevel(0);
    const backgroundNoise = samplesAtLevel(0.04);

    for (let index = 0; index < 5; index += 1) {
      detector.observe(silent, spectrum(false), sampleRateHz, frameDurationMs);
      detector.observe(
        backgroundNoise,
        spectrum(false),
        sampleRateHz,
        frameDurationMs,
      );
    }

    expect(detector.snapshot()).toEqual({
      speechDurationMs: 0,
      voiceDetected: false,
    });
  });

  it('detects sustained speech-band activity locally', () => {
    const detector = new VoiceActivityDetector();

    for (let index = 0; index < 2; index += 1) {
      detector.observe(
        samplesAtLevel(0.02),
        spectrum(true),
        sampleRateHz,
        frameDurationMs,
      );
    }

    expect(detector.snapshot()).toEqual({
      speechDurationMs: 160,
      voiceDetected: true,
    });
  });

  it('requires a sustained voice segment instead of a single click-like frame', () => {
    const detector = new VoiceActivityDetector();
    detector.observe(
      samplesAtLevel(0.05),
      spectrum(true),
      sampleRateHz,
      frameDurationMs,
    );

    expect(detector.snapshot()).toEqual({
      speechDurationMs: 80,
      voiceDetected: false,
    });
  });
});
