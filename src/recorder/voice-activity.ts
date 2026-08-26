import { MINIMUM_VOICE_ACTIVITY_DURATION_MS } from '../shared/recorder-ipc';

export interface VoiceActivitySnapshot {
  speechDurationMs: number;
  voiceDetected: boolean;
}

const MINIMUM_SPEECH_BAND_RATIO = 0.6;
const MINIMUM_SPEECH_RMS = 0.006;
const NOISE_FLOOR_MULTIPLIER = 3;
const NOISE_FLOOR_SMOOTHING = 0.04;
const SPEECH_BAND_END_HZ = 4_000;
const SPEECH_BAND_START_HZ = 80;
const SPEECH_GAP_TOLERANCE_MS = 200;
const SPECTRUM_END_HZ = 8_000;

const rms = (samples: Float32Array<ArrayBuffer>): number => {
  let sumOfSquares = 0;
  for (const sample of samples) sumOfSquares += sample * sample;
  return Math.sqrt(sumOfSquares / samples.length);
};

const speechBandRatio = (
  frequencies: Float32Array<ArrayBuffer>,
  sampleRateHz: number,
): number => {
  const binWidthHz = sampleRateHz / (frequencies.length * 2);
  if (!Number.isFinite(binWidthHz) || binWidthHz <= 0) return 0;

  const startBin = Math.ceil(SPEECH_BAND_START_HZ / binWidthHz);
  const speechEndBin = Math.min(
    frequencies.length - 1,
    Math.floor(SPEECH_BAND_END_HZ / binWidthHz),
  );
  const endBin = Math.min(
    frequencies.length - 1,
    Math.floor(SPECTRUM_END_HZ / binWidthHz),
  );
  if (startBin > speechEndBin || speechEndBin > endBin) return 0;

  let totalEnergy = 0;
  let speechEnergy = 0;
  for (let index = startBin; index <= endBin; index += 1) {
    const decibels = frequencies[index];
    if (decibels === undefined || !Number.isFinite(decibels)) continue;
    const energy = 10 ** (decibels / 10);
    totalEnergy += energy;
    if (index <= speechEndBin) speechEnergy += energy;
  }
  return totalEnergy === 0 ? 0 : speechEnergy / totalEnergy;
};

export class VoiceActivityDetector {
  #currentSpeechDurationMs = 0;
  #longestSpeechDurationMs = 0;
  #noiseFloor = 0.001;
  #silenceDurationMs = 0;

  observe(
    samples: Float32Array<ArrayBuffer>,
    frequencies: Float32Array<ArrayBuffer>,
    sampleRateHz: number,
    frameDurationMs: number,
  ): VoiceActivitySnapshot {
    if (
      samples.length === 0 ||
      frequencies.length === 0 ||
      !Number.isFinite(sampleRateHz) ||
      sampleRateHz <= 0 ||
      !Number.isFinite(frameDurationMs) ||
      frameDurationMs <= 0
    ) {
      return this.snapshot();
    }

    const level = rms(samples);
    const requiredLevel = Math.max(
      MINIMUM_SPEECH_RMS,
      this.#noiseFloor * NOISE_FLOOR_MULTIPLIER,
    );
    const isSpeechFrame =
      level >= requiredLevel &&
      speechBandRatio(frequencies, sampleRateHz) >= MINIMUM_SPEECH_BAND_RATIO;

    if (isSpeechFrame) {
      this.#currentSpeechDurationMs += frameDurationMs;
      this.#silenceDurationMs = 0;
      this.#longestSpeechDurationMs = Math.max(
        this.#longestSpeechDurationMs,
        this.#currentSpeechDurationMs,
      );
      return this.snapshot();
    }

    this.#noiseFloor += (level - this.#noiseFloor) * NOISE_FLOOR_SMOOTHING;
    this.#silenceDurationMs += frameDurationMs;
    if (this.#silenceDurationMs > SPEECH_GAP_TOLERANCE_MS) {
      this.#currentSpeechDurationMs = 0;
    }
    return this.snapshot();
  }

  snapshot(): VoiceActivitySnapshot {
    return {
      speechDurationMs: Math.round(this.#longestSpeechDurationMs),
      voiceDetected:
        this.#longestSpeechDurationMs >= MINIMUM_VOICE_ACTIVITY_DURATION_MS,
    };
  }
}
