import { describe, expect, it } from 'vitest';
import {
  BAILIAN_WAV_SAMPLE_RATE_HZ,
  encodePcm16Wav,
} from '../../src/recorder/wav';

const ascii = (view: DataView, offset: number, length: number): string =>
  String.fromCharCode(
    ...Array.from({ length }, (_, index) => view.getUint8(offset + index)),
  );

describe('encodePcm16Wav', () => {
  it('encodes mono 16 kHz PCM with a valid WAV header', () => {
    const result = encodePcm16Wav(new Float32Array([-1, 0, 0.5, 1]));
    const view = new DataView(result);

    expect(ascii(view, 0, 4)).toBe('RIFF');
    expect(view.getUint32(4, true)).toBe(44);
    expect(ascii(view, 8, 4)).toBe('WAVE');
    expect(ascii(view, 12, 4)).toBe('fmt ');
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(BAILIAN_WAV_SAMPLE_RATE_HZ);
    expect(view.getUint16(34, true)).toBe(16);
    expect(ascii(view, 36, 4)).toBe('data');
    expect(view.getUint32(40, true)).toBe(8);
    expect(view.getInt16(44, true)).toBe(-32_768);
    expect(view.getInt16(46, true)).toBe(0);
    expect(view.getInt16(48, true)).toBe(16_384);
    expect(view.getInt16(50, true)).toBe(32_767);
  });

  it('clips out-of-range samples', () => {
    const view = new DataView(encodePcm16Wav(new Float32Array([-2, 2]), 8_000));

    expect(view.getUint32(24, true)).toBe(8_000);
    expect(view.getInt16(44, true)).toBe(-32_768);
    expect(view.getInt16(46, true)).toBe(32_767);
  });
});
