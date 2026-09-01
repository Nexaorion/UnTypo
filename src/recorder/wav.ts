export const BAILIAN_WAV_SAMPLE_RATE_HZ = 16_000;

const writeAscii = (view: DataView, offset: number, value: string): void => {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
};

export const encodePcm16 = (samples: Float32Array): ArrayBuffer => {
  const bytesPerSample = 2;
  const buffer = new ArrayBuffer(samples.length * bytesPerSample);
  const view = new DataView(buffer);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.min(1, Math.max(-1, samples[index] ?? 0));
    view.setInt16(
      index * bytesPerSample,
      sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff),
      true,
    );
  }
  return buffer;
};

export const encodePcm16WavChunks = (
  chunks: readonly Uint8Array[],
  sampleRateHz = BAILIAN_WAV_SAMPLE_RATE_HZ,
): ArrayBuffer => {
  if (!Number.isInteger(sampleRateHz) || sampleRateHz < 1) {
    throw new Error('WAV sample rate must be a positive integer');
  }
  const dataByteLength = chunks.reduce(
    (total, chunk) => total + chunk.byteLength,
    0,
  );
  if (dataByteLength % 2 !== 0) {
    throw new Error('PCM16 data must contain complete samples');
  }

  const bytesPerSample = 2;
  const buffer = new ArrayBuffer(44 + dataByteLength);
  const view = new DataView(buffer);
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataByteLength, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRateHz, true);
  view.setUint32(28, sampleRateHz * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataByteLength, true);
  const output = new Uint8Array(buffer);
  let offset = 44;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return buffer;
};

export const encodePcm16Wav = (
  samples: Float32Array,
  sampleRateHz = BAILIAN_WAV_SAMPLE_RATE_HZ,
): ArrayBuffer =>
  encodePcm16WavChunks([new Uint8Array(encodePcm16(samples))], sampleRateHz);
