import { describe, expect, it, vi } from 'vitest';
import { ClipboardInjectionService } from '../../src/main/dictation/clipboard';
import {
  NativePasteStatus,
  type NativeTargetSnapshot,
} from '../../src/main/native/protocol';

const target: NativeTargetSnapshot = {
  editable: true,
  higherIntegrity: false,
  processId: 42,
  windowHandle: '4660',
};

describe('ClipboardInjectionService', () => {
  it('restores the prior clipboard after a successful unchanged paste', async () => {
    let current = 'original';
    const restore = vi.fn((snapshot: string) => {
      current = snapshot;
    });
    const service = new ClipboardInjectionService(
      {
        isCurrentText: (text: string) => current === text,
        readSnapshot: () => current,
        restore,
        writeText: (text: string) => {
          current = text;
        },
      },
      { paste: () => Promise.resolve(NativePasteStatus.Success) },
      async () => Promise.resolve(),
    );

    await expect(service.inject('result', target)).resolves.toEqual({
      injected: true,
      status: NativePasteStatus.Success,
    });
    expect(restore).toHaveBeenCalledWith('original');
    expect(current).toBe('original');
  });

  it('does not overwrite clipboard changes made during paste', async () => {
    let current = 'original';
    const restore = vi.fn();
    const service = new ClipboardInjectionService(
      {
        isCurrentText: (text: string) => current === text,
        readSnapshot: () => current,
        restore,
        writeText: (text: string) => {
          current = text;
        },
      },
      {
        paste: () => {
          current = 'user copied something else';
          return Promise.resolve(NativePasteStatus.Success);
        },
      },
      async () => Promise.resolve(),
    );

    await service.inject('result', target);

    expect(restore).not.toHaveBeenCalled();
    expect(current).toBe('user copied something else');
  });

  it('keeps the generated result when target validation fails', async () => {
    let current = 'original';
    const restore = vi.fn();
    const service = new ClipboardInjectionService(
      {
        isCurrentText: (text: string) => current === text,
        readSnapshot: () => current,
        restore,
        writeText: (text: string) => {
          current = text;
        },
      },
      { paste: () => Promise.resolve(NativePasteStatus.TargetChanged) },
    );

    await expect(service.inject('result', target)).resolves.toMatchObject({
      injected: false,
      status: NativePasteStatus.TargetChanged,
    });
    expect(restore).not.toHaveBeenCalled();
    expect(current).toBe('result');
  });
});
