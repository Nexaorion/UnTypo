export class AudioBufferLimitError extends Error {
  constructor(maximumBytes: number) {
    super(`Recording exceeded the ${String(maximumBytes)} byte memory limit`);
    this.name = 'AudioBufferLimitError';
  }
}

export class InMemoryAudioBuffer {
  readonly #chunks: Uint8Array[] = [];
  readonly #maximumBytes: number;
  #byteLength = 0;

  constructor(maximumBytes: number) {
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
      throw new Error('Audio buffer limit must be a positive safe integer');
    }
    this.#maximumBytes = maximumBytes;
  }

  get byteLength(): number {
    return this.#byteLength;
  }

  append(chunk: Uint8Array): void {
    if (chunk.byteLength === 0) return;
    if (this.#byteLength + chunk.byteLength > this.#maximumBytes) {
      throw new AudioBufferLimitError(this.#maximumBytes);
    }
    this.#chunks.push(chunk.slice());
    this.#byteLength += chunk.byteLength;
  }

  consume(): Uint8Array {
    const combined = new Uint8Array(this.#byteLength);
    let offset = 0;
    for (const chunk of this.#chunks) {
      combined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    this.clear();
    return combined;
  }

  clear(): void {
    this.#chunks.length = 0;
    this.#byteLength = 0;
  }
}
