import { beforeEach, describe, expect, it, vi } from 'vitest';

const electronMocks = vi.hoisted(() => {
  const clipboard = {
    clear: vi.fn(),
    read: vi.fn(),
    readText: vi.fn(),
    write: vi.fn(),
    writeText: vi.fn(),
  };
  return { clipboard };
});

vi.mock('electron', () => ({ clipboard: electronMocks.clipboard }));

import { ElectronClipboardAdapter } from '../../src/main/dictation/electron-clipboard';

describe('ElectronClipboardAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('restores every clipboard item captured through Electron 44', async () => {
    const clipboardItems = [{ types: ['text/plain', 'text/html'] }];
    electronMocks.clipboard.read.mockResolvedValue(clipboardItems);
    electronMocks.clipboard.write.mockResolvedValue(undefined);
    const adapter = new ElectronClipboardAdapter();

    const snapshot = await adapter.readSnapshot();
    await adapter.restore(snapshot);

    expect(electronMocks.clipboard.read).toHaveBeenCalledOnce();
    expect(electronMocks.clipboard.write).toHaveBeenCalledWith(clipboardItems);
  });

  it('clears the clipboard when the captured snapshot is empty', async () => {
    const adapter = new ElectronClipboardAdapter();

    await adapter.restore([]);

    expect(electronMocks.clipboard.clear).toHaveBeenCalledOnce();
    expect(electronMocks.clipboard.write).not.toHaveBeenCalled();
  });

  it('uses the asynchronous text methods', async () => {
    electronMocks.clipboard.readText.mockResolvedValue('generated text');
    electronMocks.clipboard.writeText.mockResolvedValue(undefined);
    const adapter = new ElectronClipboardAdapter();

    await adapter.writeText('generated text');

    await expect(adapter.isCurrentText('generated text')).resolves.toBe(true);
    expect(electronMocks.clipboard.writeText).toHaveBeenCalledWith(
      'generated text',
    );
  });
});
