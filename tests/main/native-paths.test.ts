import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  nativeHelperFileName,
  nativeIpcPath,
} from '../../src/main/native/client';

describe('native helper paths', () => {
  it('uses an .exe helper name only on Windows', () => {
    expect(nativeHelperFileName('win32')).toBe('untypo_native_helper.exe');
    expect(nativeHelperFileName('darwin')).toBe('untypo_native_helper');
  });

  it('uses a named pipe on Windows and a unix socket on macOS', () => {
    expect(nativeIpcPath(12, 'abc', 'win32')).toBe(
      '\\\\.\\pipe\\untypo-12-abc',
    );
    expect(nativeIpcPath(12, 'abc', 'darwin')).toBe(
      path.join(os.tmpdir(), 'untypo-12-abc.sock'),
    );
  });

  it('keeps Darwin socket paths within sockaddr_un limits', () => {
    const tmpdir = vi.spyOn(os, 'tmpdir').mockReturnValue('x'.repeat(200));
    try {
      const socketPath = nativeIpcPath(12, 'abc', 'darwin');
      expect(Buffer.byteLength(socketPath, 'utf8')).toBeLessThan(104);
      expect(socketPath).toContain('u-12-');
    } finally {
      tmpdir.mockRestore();
    }
  });
});
