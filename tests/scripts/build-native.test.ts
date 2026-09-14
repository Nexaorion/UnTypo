import { EventEmitter } from 'node:events';
import path from 'node:path';
import process from 'node:process';
import { setImmediate } from 'node:timers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const buildScript = '../../scripts/build-native.mjs';

const { mkdir, readFile, rm, spawn } = vi.hoisted(() => ({
  mkdir: vi.fn(),
  readFile: vi.fn(),
  rm: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({ mkdir, readFile, rm }));
vi.mock('node:child_process', () => ({ spawn }));

describe('macOS native build cache', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
    vi.stubGlobal('process', { ...process, platform: 'darwin' });
    spawn.mockImplementation(() => {
      const child = new EventEmitter();
      setImmediate(() => child.emit('exit', 0));
      return child;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each(['\n', '\r\n'])(
    'preserves a matching cache with %j line endings',
    async (newline) => {
      readFile.mockResolvedValue(
        `CMAKE_HOME_DIRECTORY:INTERNAL=${path.resolve('native/helper')}${newline}`,
      );

      await import(buildScript);

      expect(rm).not.toHaveBeenCalled();
      expect(spawn).toHaveBeenCalledTimes(2);
    },
  );

  it.each([
    `CMAKE_HOME_DIRECTORY:INTERNAL=${process.cwd()}-copy/native/helper\n`,
    `OTHER:INTERNAL=${process.cwd()}\nCMAKE_HOME_DIRECTORY:INTERNAL=/old/native/helper\n`,
    '',
  ])('removes a stale or incomplete cache: %j', async (cache) => {
    readFile.mockResolvedValue(cache);

    await import(buildScript);

    expect(rm).toHaveBeenCalledWith('build/native-mac', {
      recursive: true,
      force: true,
    });
    expect(rm.mock.invocationCallOrder[0]).toBeLessThan(
      spawn.mock.invocationCallOrder[0] ?? 0,
    );
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it('continues configuration when the cache cannot be read', async () => {
    readFile.mockRejectedValue(new Error('Cache unavailable'));

    await import(buildScript);

    expect(rm).not.toHaveBeenCalled();
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it('stops before CMake when stale cache removal fails', async () => {
    readFile.mockResolvedValue(
      'CMAKE_HOME_DIRECTORY:INTERNAL=/old/native/helper\n',
    );
    const error = new Error('Cache removal denied');
    rm.mockRejectedValue(error);

    await expect(import(buildScript)).rejects.toBe(error);

    expect(spawn).not.toHaveBeenCalled();
  });
});
