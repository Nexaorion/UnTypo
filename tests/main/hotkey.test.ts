import { describe, expect, it } from 'vitest';
import { parseHotkeyAccelerator } from '../../src/main/native/hotkey';

describe('parseHotkeyAccelerator', () => {
  it('maps the default Windows push-to-talk shortcut', () => {
    expect(parseHotkeyAccelerator('Ctrl+Shift+Space', 'push-to-talk')).toEqual({
      mode: 'push-to-talk',
      modifiers: 6,
      virtualKey: 0x20,
    });
  });

  it('supports toggle shortcuts and function keys', () => {
    expect(parseHotkeyAccelerator('Alt+F12', 'toggle')).toEqual({
      mode: 'toggle',
      modifiers: 1,
      virtualKey: 0x7b,
    });
  });

  it('rejects ambiguous shortcut definitions', () => {
    expect(() => parseHotkeyAccelerator('Ctrl+A+B', 'toggle')).toThrow(
      'multiple keys',
    );
    expect(() => parseHotkeyAccelerator('Ctrl+Shift', 'toggle')).toThrow(
      'has no key',
    );
  });
});
