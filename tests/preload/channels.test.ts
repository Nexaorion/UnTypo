import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { IPC_CHANNELS } from '../../src/shared/ipc';

describe('sandboxed preload channels', () => {
  it('keeps the self-contained ping channel aligned with the main process', async () => {
    const source = await readFile('src/preload/index.ts', 'utf8');

    expect(source).toContain(`const PING_CHANNEL = '${IPC_CHANNELS.ping}'`);
  });
});
