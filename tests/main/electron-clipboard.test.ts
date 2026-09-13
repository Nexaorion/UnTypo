import { beforeEach, describe, expect, it, vi } from 'vitest';

const electronMocks = vi.hoisted(() => {
  const clipboard = {
    clear: vi.fn(),
    read: vi.fn(),
    readText: vi.fn(),
    write: vi.fn(),
    writeText: vi.fn(),
  };
  const ClipboardItem = vi.fn(function (data: Record<string, unknown>) {
    return { data };
  });
  return { clipboard, ClipboardItem };
});

vi.mock('electron', () => ({
  clipboard: electronMocks.clipboard,
  ClipboardItem: electronMocks.ClipboardItem,
}));

import { ElectronClipboardAdapter } from '../../src/main/dictation/electron-clipboard';

describe('ElectronClipboardAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('restores every clipboard item captured through Electron 44', async () => {
    const plain = new Blob(['plain']);
    const html = new Blob(['<b>plain</b>']);
    const bookmark = { title: 'Test', url: 'https://example.com' };
    const getType = vi.fn((type: string) =>
      Promise.resolve(
        type === 'text/plain' ? plain : type === 'text/html' ? html : bookmark,
      ),
    );
    const clipboardItems = [
      {
        types: ['text/plain', 'text/html', 'electron application/bookmark'],
        getType,
      },
    ];
    electronMocks.clipboard.read.mockResolvedValue(clipboardItems);
    electronMocks.clipboard.write.mockResolvedValue(undefined);
    const adapter = new ElectronClipboardAdapter();

    const snapshot = await adapter.readSnapshot();
    await adapter.restore(snapshot);

    expect(electronMocks.clipboard.read).toHaveBeenCalledOnce();
    expect(electronMocks.ClipboardItem).toHaveBeenCalledWith({
      'text/plain': plain,
      'text/html': html,
      'electron application/bookmark': bookmark,
    });
    expect(electronMocks.clipboard.write).toHaveBeenCalledWith(snapshot);
    expect(snapshot[0]).not.toBe(clipboardItems[0]);
    expect(getType).toHaveBeenCalledTimes(3);
  });

  it('skips clipboard items that have no MIME types', async () => {
    electronMocks.clipboard.read.mockResolvedValue([
      { types: [], getType: vi.fn() },
    ]);
    const adapter = new ElectronClipboardAdapter();

    await expect(adapter.readSnapshot()).resolves.toEqual([]);
    expect(electronMocks.ClipboardItem).not.toHaveBeenCalled();
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
