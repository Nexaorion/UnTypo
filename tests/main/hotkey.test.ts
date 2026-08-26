import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseHotkeyAccelerator } from '../../src/main/native/hotkey';

describe('parseHotkeyAccelerator', () => {
  it('maps the default Windows shortcut', () => {
    expect(parseHotkeyAccelerator('Ctrl+Alt+Space')).toEqual({
      modifiers: 0x0003,
      virtualKey: 0x20,
    });
  });

  it('supports function keys', () => {
    expect(parseHotkeyAccelerator('Alt+F12')).toEqual({
      modifiers: 0x0001,
      virtualKey: 0x7b,
    });
  });

  it('maps the number row, numeric keypad, and bare Alt distinctly', () => {
    expect(parseHotkeyAccelerator('Ctrl+0')).toEqual({
      modifiers: 0x0002,
      virtualKey: 0x30,
    });
    expect(parseHotkeyAccelerator('Ctrl+Numpad0')).toEqual({
      modifiers: 0x0002,
      virtualKey: 0x60,
    });
    expect(parseHotkeyAccelerator('Alt')).toEqual({
      modifiers: 0,
      virtualKey: 0x12,
    });
  });

  it('rejects ambiguous shortcut definitions', () => {
    expect(() => parseHotkeyAccelerator('Ctrl+A+B')).toThrow('multiple keys');
    expect(() => parseHotkeyAccelerator('Ctrl+Shift')).toThrow('has no key');
  });
});

describe('native hotkey registration', () => {
  it('uses acknowledged, transactional RegisterHotKey configuration', async () => {
    const monitorSource = await readFile(
      'native/helper/src/hotkey_monitor.cpp',
      'utf8',
    );
    const pipeSource = await readFile(
      'native/helper/src/pipe_server.cpp',
      'utf8',
    );

    expect(monitorSource).toContain('RegisterHotKey(');
    expect(monitorSource).toContain('MOD_NOREPEAT');
    expect(monitorSource).toContain('const int candidate_id');
    expect(monitorSource).toMatch(
      /RegisterHotKey[\s\S]*?UnregisterHotKey[\s\S]*?registered_hotkey_id_ = candidate_id/u,
    );
    expect(monitorSource).toContain('SendMessageW(');
    expect(monitorSource).not.toContain('SetWindowsHookExW');
    expect(pipeSource).toContain('MessageType::HotkeyConfigured');
    expect(pipeSource).toMatch(
      /callbacks_\.configure_hotkey\(configuration\)[\s\S]*?WriteFrame/u,
    );
  });
});
