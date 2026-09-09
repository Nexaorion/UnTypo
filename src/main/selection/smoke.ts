import { app, BrowserWindow, clipboard, nativeTheme } from 'electron';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  SupportedLanguage,
  TextGenerationProvider,
} from '../../core/providers/contracts.js';
import { textProviderCapabilities } from '../../core/providers/text-provider-utils.js';
import { ElectronClipboardAdapter } from '../dictation/electron-clipboard.js';
import type { NativeHelperClient } from '../native/client.js';
import { NativePasteStatus } from '../native/protocol.js';
import { SelectionWindowController } from './selection-window.js';
import { focusSelectionFixture } from './smoke-focus.js';
import { DictationCoordinator } from '../dictation/coordinator.js';
import { MockDictationProvider } from '../../core/providers/mock-provider.js';
import {
  SpeechProviderRegistry,
  TextProviderRegistry,
} from '../../core/providers/registry.js';
import { DEFAULT_APPLICATION_WRITING_STYLES } from '../../shared/personalization.js';
import { NativeHotkeyAction } from '../native/protocol.js';

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
const assert = (condition: unknown, step: string): void => {
  if (!condition) throw new Error(`Selection smoke failed: ${step}`);
};

export const runSelectionSmokeTest = async (
  realNative: NativeHelperClient,
): Promise<void> => {
  const verifyNative = process.argv.includes('--smoke-selection-native');
  const originalTheme = nativeTheme.themeSource;
  const originalAccessibility = app.accessibilitySupportEnabled;
  const adapter = new ElectronClipboardAdapter();
  const originalClipboard = await adapter.readSnapshot();
  app.setAccessibilitySupportEnabled(true);
  let locale: SupportedLanguage = 'en-US';
  let mode: 'success' | 'error' | 'pending' = 'success';
  let expectedSource =
    '富士山は日本を象徴する山です。古くから信仰の対象となり、人々の自然観や文化に深い影響を与えてきました。現在も、多くの人が登山や遠くから眺めることを通して、その美しさに親しんでいます。';
  const answer =
    'Mount Fuji is an iconic symbol of Japan. Revered as a sacred mountain since ancient times, it has deeply influenced the way people see nature and shaped Japanese culture.\n\nToday, many people continue to appreciate its beauty, whether by climbing its slopes or admiring it from afar.';
  const provider: TextGenerationProvider = {
    id: 'selection-smoke',
    displayName: 'Selection smoke',
    kind: 'local',
    contractVersion: '3.0',
    capabilities: textProviderCapabilities,
    configSchema: {},
    processTranscript: async (text, context) => {
      assert(text === expectedSource, 'captured source');
      assert(Boolean(context.selectionInstruction), 'instruction context');
      if (mode === 'error') throw new Error('Simulated failure');
      if (mode === 'pending') {
        await new Promise<void>((_resolve, reject) =>
          context.signal?.addEventListener(
            'abort',
            () => reject(new Error('cancelled')),
            { once: true },
          ),
        );
      }
      context.onOutputTextUpdate?.('Mount Fuji');
      await wait(100);
      return { intent: 'translation', outputText: answer };
    },
  };
  const target = new BrowserWindow({
    show: false,
    width: 680,
    height: 360,
    title: 'UnTypo selection smoke fixture',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  target.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  target.webContents.on('will-navigate', (event) => event.preventDefault());
  let capturedFixture:
    { text: string; editable: boolean; start: number; end: number } | undefined;
  const fixtureSelection = () =>
    target.webContents.executeJavaScript(`(() => {
    const field = document.activeElement;
    if (field instanceof HTMLTextAreaElement) return { text: field.value.slice(field.selectionStart, field.selectionEnd), editable: true, start: field.selectionStart, end: field.selectionEnd };
    return { text: field?.tagName === 'INPUT' ? '' : getSelection()?.toString() || '', editable: false, start: 0, end: 0 };
  })()`) as Promise<{
      text: string;
      editable: boolean;
      start: number;
      end: number;
    }>;
  const native = verifyNative
    ? realNative
    : {
        captureTarget: () =>
          Promise.resolve({
            windowHandle: target
              .getNativeWindowHandle()
              .readBigUInt64LE()
              .toString(),
            processId: process.pid,
            editable: true,
            higherIntegrity: false,
          }),
        captureSelection: async () => {
          capturedFixture = await fixtureSelection();
          return capturedFixture;
        },
        clearSelection: () => {
          capturedFixture = undefined;
          return Promise.resolve();
        },
        replaceSelection: async () => {
          const current = await fixtureSelection();
          if (!capturedFixture?.editable) return NativePasteStatus.NotEditable;
          if (
            current.text !== capturedFixture.text ||
            current.start !== capturedFixture.start ||
            current.end !== capturedFixture.end
          )
            return NativePasteStatus.TargetChanged;
          await target.webContents.insertText(await clipboard.readText());
          return NativePasteStatus.Success;
        },
      };
  const controller = new SelectionWindowController({
    native,
    context: () =>
      Promise.resolve({ locale, defaultTargetLanguage: 'en-US', provider }),
  });
  const spokenInstruction = 'Translate to English';
  const speech = new MockDictationProvider({ transcript: spokenInstruction });
  const speechProviders = new SpeechProviderRegistry();
  speechProviders.register(speech);
  const textProviders = new TextProviderRegistry();
  textProviders.register(provider);
  const coordinator = new DictationCoordinator({
    native,
    selection: controller,
    speechProviders,
    textProviders,
    getContext: () => ({
      applicationStyles: DEFAULT_APPLICATION_WRITING_STYLES,
      learnedPreferences: [],
      history: { enabled: false, retentionDays: 0 },
      preferenceLearningEnabled: false,
      options: {
        defaultTargetLanguage: 'en-US',
        dictionary: [],
        language: 'en-US',
        fastMode: true,
      },
      speechProviderId: speech.id,
      textProviderId: provider.id,
      uiLanguage: locale,
    }),
    recorder: {
      start: () => Promise.resolve('voice-selection-smoke'),
      stop: async () => ({
        sessionId: 'voice-selection-smoke',
        target: await native.captureTarget(),
        audio: {
          bytes: new Uint8Array(2048),
          mimeType: 'audio/webm',
          channels: 1,
          sampleRateHz: 48_000,
          durationMs: 1000,
        },
        peakLevel: 0.5,
        speechDurationMs: 800,
        voiceDetected: true,
      }),
    },
    history: {
      record: () => {
        throw new Error('Selection voice should not enter dictation history');
      },
    },
    injection: {
      inject: () => {
        throw new Error(
          'Selection voice should not paste the spoken instruction',
        );
      },
    },
    presenter: {
      showConfirm: () => {
        throw new Error('Selection voice should open results automatically');
      },
      showError: () => undefined,
      showProcessing: () => undefined,
      showRecording: () => undefined,
      showSuccess: () => undefined,
      updateProcessing: () => undefined,
    },
  });
  try {
    await target.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent('<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"><title>Selection smoke fixture</title><textarea aria-label="Selection smoke fixture" style="width:90%;height:160px;font-size:20px"></textarea><p tabindex="0">Read-only source text</p><input type="password" aria-label="Password fixture">')}`,
    );
    const select = async (source = expectedSource) => {
      target.show();
      target.focus();
      if (verifyNative) await focusSelectionFixture(target);
      await target.webContents.executeJavaScript(
        `(() => { const field = document.querySelector('textarea'); field.value = ''; field.focus(); })()`,
      );
      // insertText passes the fixture text as data instead of interpolated code.
      await target.webContents.insertText(source);
      await target.webContents.executeJavaScript(
        `(() => { const field = document.querySelector('textarea'); field.select(); })()`,
      );
      await wait(350);
    };
    const panel = (): BrowserWindow => {
      const window = BrowserWindow.getAllWindows().find((candidate) =>
        candidate.webContents.getURL().endsWith('/selection.html'),
      );
      if (!window) throw new Error('Selection smoke window missing');
      return window;
    };
    const phase = async (window: BrowserWindow, expected: string) => {
      for (let attempt = 0; attempt < 50; attempt += 1) {
        if (
          await window.webContents.executeJavaScript(
            `document.querySelector('main')?.dataset.phase === ${JSON.stringify(expected)}`,
          )
        )
          return;
        await wait(50);
      }
      throw new Error(`Selection smoke phase timeout: ${expected}`);
    };
    const generate = async (window: BrowserWindow) => {
      await window.webContents.executeJavaScript(
        `Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'Generate again')?.click()`,
      );
    };
    const dictate = async () => {
      await coordinator.handleHotkey(NativeHotkeyAction.Toggle);
      assert(coordinator.state === 'recording', 'same hotkey starts recording');
      assert(
        !BrowserWindow.getAllWindows().some(
          (window) =>
            window.isVisible() &&
            window.webContents.getURL().endsWith('/selection.html'),
        ),
        'no manual popup before speaking',
      );
      await coordinator.handleHotkey(NativeHotkeyAction.Toggle);
      assert(
        coordinator.state === 'idle',
        'same hotkey finishes voice processing',
      );
    };
    await select();
    const captured = await native.captureSelection();
    assert(
      captured.text === expectedSource && captured.editable,
      verifyNative
        ? 'native editable capture (requires foreground desktop access)'
        : 'fixture capture',
    );
    await native.clearSelection();
    for (const scheme of ['light', 'dark'] as const) {
      nativeTheme.themeSource = scheme;
      locale = scheme === 'light' ? 'en-US' : 'zh-CN';
      await select();
      await dictate();
      const window = panel();
      await phase(window, 'ready');
      assert(
        await window.webContents.executeJavaScript(
          `document.querySelector('[data-selection-instruction]')?.textContent === ${JSON.stringify(spokenInstruction)} && !document.querySelector('input, textarea, [contenteditable="true"]')`,
        ),
        'spoken input displayed without manual fields',
      );
      assert(
        await window.webContents.executeJavaScript(
          `document.querySelector('[data-selection-output]')?.textContent === ${JSON.stringify(answer)}`,
        ),
        'translated answer',
      );
      await wait(200);
      await writeFile(
        path.join(app.getAppPath(), `build/selection-smoke-${scheme}.png`),
        (await window.webContents.capturePage()).toPNG(),
      );
      for (const size of [
        { width: 375, height: 480 },
        { width: 520, height: 340 },
      ]) {
        window.setBounds(size);
        await wait(100);
        assert(
          await window.webContents.executeJavaScript(
            `(() => { const main = document.querySelector('main'); const rect = main.getBoundingClientRect(); return document.documentElement.scrollWidth <= innerWidth && main.scrollWidth <= main.clientWidth && rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight; })()`,
          ),
          'responsive bounds',
        );
      }
      await window.webContents.executeJavaScript(
        `document.querySelector('button[aria-label="${scheme === 'light' ? 'Copy' : '复制'}"]')?.click()`,
      );
      await wait(100);
      assert((await clipboard.readText()) === answer, 'copy action');
      if (scheme === 'light' && verifyNative) {
        const sessionId: unknown = await window.webContents.executeJavaScript(
          'window.selection.getState().then(state => state.sessionId)',
        );
        await focusSelectionFixture(window);
        await dictate();
        await phase(window, 'ready');
        assert(
          await window.webContents.executeJavaScript(
            `window.selection.getState().then(state => state.sessionId === ${JSON.stringify(sessionId)})`,
          ),
          'same hotkey retains source for follow-up voice',
        );
      }
      controller.close();
    }
    locale = 'en-US';
    await select();
    mode = 'error';
    await dictate();
    const window = panel();
    await phase(window, 'error');
    mode = 'pending';
    await generate(window);
    await phase(window, 'processing');
    await window.webContents.executeJavaScript(
      `Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'Cancel')?.click()`,
    );
    await phase(window, 'listening');
    mode = 'success';
    await generate(window);
    await phase(window, 'ready');
    await window.webContents.executeJavaScript(
      `Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'Replace selection')?.click()`,
    );
    for (let attempt = 0; attempt < 40 && controller.isOpen; attempt += 1)
      await wait(50);
    if (controller.isOpen) {
      const state = (await window.webContents.executeJavaScript(
        'window.selection.getState()',
      )) as { error?: string };
      throw new Error(
        `Selection smoke replacement failed: ${state.error ?? 'unknown'}`,
      );
    }
    assert(
      await target.webContents.executeJavaScript(
        `document.querySelector('textarea').value === ${JSON.stringify(answer)}`,
      ),
      'native replacement',
    );

    await select();
    await native.captureSelection();
    await target.webContents.executeJavaScript(
      `document.querySelector('textarea').setSelectionRange(0, 4)`,
    );
    assert(
      (await native.replaceSelection()) === NativePasteStatus.TargetChanged,
      'changed selection rejected',
    );
    await native.clearSelection();
    await target.webContents.executeJavaScript(
      `(() => { const field = document.querySelector('input'); field.value = 'fixture-only'; field.focus(); field.select(); })()`,
    );
    await wait(200);
    assert(
      (await native.captureSelection()).text === '',
      'password selection rejected',
    );
    await target.webContents.executeJavaScript(
      `(() => { const field = document.querySelector('p'); field.focus(); const range = document.createRange(); range.selectNodeContents(field); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); })()`,
    );
    await wait(200);
    expectedSource = 'Read-only source text';
    const readOnly = await native.captureSelection();
    assert(
      readOnly.text === expectedSource && !readOnly.editable,
      'native read-only capture',
    );
    await native.clearSelection();
    await dictate();
    const readOnlyPanel = panel();
    await phase(readOnlyPanel, 'ready');
    assert(
      await readOnlyPanel.webContents.executeJavaScript(
        `!Array.from(document.querySelectorAll('button')).some(button => button.textContent === 'Replace selection')`,
      ),
      'read-only result',
    );
    controller.close();
    await select('');
    assert(
      !(await controller.prepareVoice(await native.captureTarget())),
      'no selection retains normal dictation',
    );
    console.log(
      `SELECTION_SMOKE_OK ${verifyNative ? 'native-uia' : 'simulated-selection'} single-hotkey simulated-voice automatic-popup translate stream copy replace cancel retry light dark responsive`,
    );
  } finally {
    controller.destroy();
    target.destroy();
    nativeTheme.themeSource = originalTheme;
    app.setAccessibilitySupportEnabled(originalAccessibility);
    await adapter.restore(originalClipboard);
  }
};
