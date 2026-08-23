import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { IPC_CHANNELS } from '../../src/shared/ipc';
import { RECORDER_CHANNELS } from '../../src/shared/recorder-ipc';

describe('sandboxed preload channels', () => {
  it('keeps the self-contained ping channel aligned with the main process', async () => {
    const source = await readFile('src/preload/index.ts', 'utf8');

    expect(source).toContain(`const PING_CHANNEL = '${IPC_CHANNELS.ping}'`);
  });

  it('keeps every recorder channel aligned with the main process', async () => {
    const source = await readFile('src/preload/recorder.ts', 'utf8');

    for (const channel of Object.values(RECORDER_CHANNELS)) {
      expect(source).toContain(`'${channel}'`);
    }
  });
});
