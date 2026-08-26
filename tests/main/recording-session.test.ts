import { describe, expect, it } from 'vitest';
import { RecordingSessionManager } from '../../src/main/recording/session';

const target = { processId: 42, windowHandle: '0x1234' };
const metadata = {
  channels: 1,
  mimeType: 'audio/webm;codecs=opus',
  sampleRateHz: 48_000,
};

describe('RecordingSessionManager', () => {
  it('keeps audio in memory through a complete session', () => {
    const manager = new RecordingSessionManager(1024);
    const sessionId = manager.begin(target);
    manager.markStarted(sessionId, metadata);
    manager.append(sessionId, new Uint8Array([1, 2]));
    manager.append(sessionId, new Uint8Array([3]));
    manager.requestStop();

    const completed = manager.complete(sessionId, {
      ...metadata,
      durationMs: 750,
      peakLevel: 0.42,
    });

    expect(completed).toMatchObject({ sessionId, target });
    expect(completed.peakLevel).toBe(0.42);
    expect(completed.audio).toMatchObject({
      bytes: new Uint8Array([1, 2, 3]),
      durationMs: 750,
      mimeType: 'audio/webm;codecs=opus',
    });
    expect(manager.state).toBe('idle');
  });

  it('rejects chunks from stale sessions', () => {
    const manager = new RecordingSessionManager();
    const sessionId = manager.begin(target);
    manager.markStarted(sessionId, metadata);

    expect(() => manager.append('stale', new Uint8Array([1]))).toThrow(
      'stale recorder session',
    );
  });

  it('rejects invalid microphone level metadata', () => {
    const manager = new RecordingSessionManager();
    const sessionId = manager.begin(target);
    manager.markStarted(sessionId, metadata);
    manager.requestStop();

    expect(() =>
      manager.complete(sessionId, {
        ...metadata,
        durationMs: 500,
        peakLevel: Number.NaN,
      }),
    ).toThrow('invalid stop metadata');
  });

  it('releases buffered audio when a session fails', () => {
    const manager = new RecordingSessionManager();
    const sessionId = manager.begin(target);
    manager.markStarted(sessionId, metadata);
    manager.append(sessionId, new Uint8Array([1]));
    manager.fail(sessionId);

    expect(manager.state).toBe('idle');
    expect(() => manager.requestStop()).toThrow('No recording is active');
  });
});
