import { describe, expect, it } from 'vitest';
import {
  AudioBufferLimitError,
  InMemoryAudioBuffer,
} from '../../src/main/recording/audio-buffer';

describe('InMemoryAudioBuffer', () => {
  it('combines chunks and releases them after consumption', () => {
    const buffer = new InMemoryAudioBuffer(8);
    buffer.append(new Uint8Array([1, 2]));
    buffer.append(new Uint8Array([3]));

    expect(buffer.byteLength).toBe(3);
    expect(buffer.consume()).toEqual(new Uint8Array([1, 2, 3]));
    expect(buffer.byteLength).toBe(0);
  });

  it('rejects recordings beyond the configured memory limit', () => {
    const buffer = new InMemoryAudioBuffer(2);
    buffer.append(new Uint8Array([1, 2]));

    expect(() => buffer.append(new Uint8Array([3]))).toThrow(
      AudioBufferLimitError,
    );
  });
});
