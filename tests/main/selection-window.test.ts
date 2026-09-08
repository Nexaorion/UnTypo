import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SELECTION_CHANNELS } from '../../src/shared/selection-ipc';
import { NativePasteStatus } from '../../src/main/native/protocol';
import { OpenAICompatibleTextProvider } from '../../src/core/providers/openai-compatible-text-provider';

const mock = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const frame = { url: 'app://renderer/selection.html' };
  const contents = {
    id: 71,
    mainFrame: frame,
    send: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
    setWindowOpenHandler: vi.fn(),
  };
  const window = {
    webContents: contents,
    getNativeWindowHandle: () => Buffer.from([71, 0, 0, 0, 0, 0, 0, 0]),
    hide: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    removeMenu: vi.fn(),
    once: vi.fn(),
    destroy: vi.fn(),
    isDestroyed: () => false,
    loadURL: vi.fn().mockResolvedValue(undefined),
  };
  let clipboardText = 'Original clipboard';
  const clipboard = {
    read: vi.fn().mockResolvedValue([
      {
        types: ['text/plain'],
        getType: () => Promise.resolve(new Blob(['Original clipboard'])),
      },
    ]),
    writeText: vi.fn((text: string) => {
      clipboardText = text;
      return Promise.resolve();
    }),
    readText: vi.fn(() => Promise.resolve(clipboardText)),
    write: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn(),
  };
  return {
    handlers,
    contents,
    frame,
    window,
    clipboard,
    BrowserWindow: vi.fn(function () {
      return window;
    }),
    ipcMain: {
      handle: vi.fn(
        (channel: string, handler: (...args: unknown[]) => unknown) =>
          handlers.set(channel, handler),
      ),
      removeHandler: vi.fn(),
    },
  };
});
vi.mock('electron', () => ({
  ClipboardItem: vi.fn(function (data: Record<string, unknown>) {
    return { data };
  }),
  BrowserWindow: mock.BrowserWindow,
  clipboard: mock.clipboard,
  ipcMain: mock.ipcMain,
  screen: {
    getCursorScreenPoint: () => ({ x: 400, y: 300 }),
    getDisplayNearestPoint: () => ({
      workArea: { x: 0, y: 0, width: 1920, height: 1080 },
    }),
  },
}));
import { SelectionWindowController } from '../../src/main/selection/selection-window';

const event = () => ({ sender: mock.contents, senderFrame: mock.frame });
const call = (channel: string, value?: unknown, sender = event()) =>
  mock.handlers.get(channel)?.(sender, value);
const target = {
  editable: true,
  higherIntegrity: false,
  processId: 42,
  windowHandle: '4660',
};
const setup = async (editable = true) => {
  const native = {
    captureTarget: vi.fn().mockResolvedValue(target),
    captureSelection: vi
      .fn()
      .mockResolvedValue({ editable, text: 'Source text' }),
    clearSelection: vi.fn().mockResolvedValue(undefined),
    replaceSelection: vi
      .fn()
      .mockResolvedValue(NativePasteStatus.TargetChanged),
  };
  const provider = new OpenAICompatibleTextProvider({
    apiKey: 'test',
    baseUrl: 'https://example.com/v1',
    model: 'test',
    id: 'test',
    displayName: 'Test',
  });
  vi.spyOn(provider, 'processTranscript').mockResolvedValue({
    intent: 'translation',
    outputText: 'Translated result',
  });
  const controller = new SelectionWindowController({
    native,
    context: () =>
      Promise.resolve({
        locale: 'en-US',
        defaultTargetLanguage: 'en-US',
        provider,
      }),
  });
  await controller.prepareVoice(target);
  expect(mock.BrowserWindow).not.toHaveBeenCalled();
  await controller.processVoice('Translate');
  const state = call(SELECTION_CHANNELS.state) as { sessionId: string };
  return { controller, native, sessionId: state.sessionId };
};
beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.VITE_DEV_SERVER_URL;
});

describe('selection window IPC and delivery', () => {
  it('retains the source for a follow-up spoken request from its popup', async () => {
    const { controller, native, sessionId } = await setup();
    expect(
      await controller.prepareVoice({ ...target, windowHandle: '71' }),
    ).toBe(true);
    expect(native.captureSelection).toHaveBeenCalledOnce();
    expect(mock.window.hide).toHaveBeenCalledOnce();
    await controller.processVoice('Rewrite for Twitter');
    expect(call(SELECTION_CHANNELS.state)).toMatchObject({
      sessionId,
      instruction: 'Rewrite for Twitter',
      phase: 'ready',
    });
    await expect(
      call(SELECTION_CHANNELS.retry, { sessionId, instruction: 'Injected' }),
    ).rejects.toThrow();
    controller.destroy();
  });

  it('continues ordinary dictation without a popup when no text is selected', async () => {
    const { controller, native } = await setup();
    native.captureSelection.mockResolvedValueOnce({ editable: true, text: '' });
    expect(await controller.prepareVoice(target)).toBe(false);
    expect(controller.isOpen).toBe(false);
    controller.destroy();
  });

  it('discards a selection when foreground focus changes during capture', async () => {
    const { controller, native } = await setup();
    native.captureTarget.mockResolvedValueOnce({
      ...target,
      windowHandle: '999',
    });
    expect(await controller.prepareVoice(target)).toBe(false);
    expect(controller.isOpen).toBe(false);
    expect(native.clearSelection).toHaveBeenCalled();
    controller.destroy();
  });

  it('requires its own trusted main frame and current session', async () => {
    const { controller } = await setup();
    expect(() =>
      call(SELECTION_CHANNELS.state, undefined, {
        sender: { ...mock.contents, id: 99 },
        senderFrame: mock.frame,
      }),
    ).toThrow();
    expect(() =>
      call(SELECTION_CHANNELS.state, undefined, {
        sender: mock.contents,
        senderFrame: { ...mock.frame },
      }),
    ).toThrow();
    await expect(
      call(SELECTION_CHANNELS.copy, {
        sessionId: '00000000-0000-4000-8000-000000000000',
      }),
    ).rejects.toThrow('expired');
    controller.destroy();
    expect(mock.ipcMain.removeHandler).toHaveBeenCalledTimes(6);
  });

  it('keeps the result and restores the clipboard when the target changed', async () => {
    const { controller, native, sessionId } = await setup();
    await call(SELECTION_CHANNELS.replace, { sessionId });
    expect(native.replaceSelection).toHaveBeenCalledOnce();
    expect(mock.clipboard.write).toHaveBeenCalled();
    expect(call(SELECTION_CHANNELS.state)).toMatchObject({
      error: 'replace',
      output: 'Translated result',
    });
    expect(mock.window.show).toHaveBeenCalledTimes(2);
    controller.destroy();
  });

  it('never replaces a read-only selection and preserves newer clipboard content', async () => {
    const { controller, native, sessionId } = await setup(false);
    await call(SELECTION_CHANNELS.replace, { sessionId });
    expect(native.replaceSelection).not.toHaveBeenCalled();
    await call(SELECTION_CHANNELS.copy, { sessionId });
    expect(mock.clipboard.writeText).toHaveBeenCalledWith('Translated result');
    controller.destroy();
  });

  it('does not overwrite a clipboard change made while replacement is pending', async () => {
    const { controller, native, sessionId } = await setup();
    native.replaceSelection.mockImplementationOnce(async () => {
      await mock.clipboard.writeText('New clipboard');
      return NativePasteStatus.TargetChanged;
    });
    await call(SELECTION_CHANNELS.replace, { sessionId });
    expect(mock.clipboard.write).not.toHaveBeenCalled();
    controller.destroy();
  });
});
