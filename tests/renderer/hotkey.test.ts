import { describe, expect, it } from 'vitest';
import { parseHotkeyAccelerator } from '../../src/main/native/hotkey';
import {
  acceleratorFromEvent,
  formatHotkeyAccelerator,
  isValidHotkeyAccelerator,
} from '../../src/renderer/logic/hotkey';

const accepted = [
  'Ctrl+Shift+Space',
  'Alt+F4',
  'Win+K',
  'Ctrl+1',
  'Escape',
  'Ctrl+Alt+Shift+Win+PageDown',
  'F24',
];

const rejected = ['', 'Ctrl', 'Ctrl+Shift', 'Ctrl+A+B', 'Ctrl+F25', 'Ctrl+Ok'];

describe('isValidHotkeyAccelerator', () => {
  it('agrees with the main-process parser on accepted accelerators', () => {
    for (const accelerator of accepted) {
      expect(isValidHotkeyAccelerator(accelerator)).toBe(true);
      expect(() =>
        parseHotkeyAccelerator(accelerator, 'push-to-talk'),
      ).not.toThrow();
    }
  });

  it('agrees with the main-process parser on rejected accelerators', () => {
    for (const accelerator of rejected) {
      expect(isValidHotkeyAccelerator(accelerator)).toBe(false);
      expect(() =>
        parseHotkeyAccelerator(accelerator, 'push-to-talk'),
      ).toThrow();
    }
  });

  it('rejects values past the stored length limit', () => {
    expect(isValidHotkeyAccelerator(`Ctrl+${'a'.repeat(200)}`)).toBe(false);
  });
});

describe('formatHotkeyAccelerator', () => {
  it('normalises aliases, order and casing', () => {
    expect(formatHotkeyAccelerator('shift+control+space')).toBe(
      'Ctrl+Shift+Space',
    );
    expect(formatHotkeyAccelerator('meta+option+k')).toBe('Alt+Win+K');
    expect(formatHotkeyAccelerator('ctrl+f5')).toBe('Ctrl+F5');
  });
});

describe('acceleratorFromEvent', () => {
  it('ignores modifier-only presses', () => {
    expect(
      acceleratorFromEvent({
        altKey: false,
        ctrlKey: true,
        key: 'Control',
        metaKey: false,
        shiftKey: false,
      }),
    ).toBeUndefined();
  });

  it('builds an accelerator the main process accepts', () => {
    const accelerator = acceleratorFromEvent({
      altKey: false,
      ctrlKey: true,
      key: ' ',
      metaKey: false,
      shiftKey: true,
    });

    expect(accelerator).toBe('Ctrl+Shift+Space');
    expect(isValidHotkeyAccelerator(accelerator ?? '')).toBe(true);
  });

  it('maps arrow keys and function keys', () => {
    const base = {
      altKey: false,
      ctrlKey: true,
      metaKey: false,
      shiftKey: false,
    };
    expect(acceleratorFromEvent({ ...base, key: 'ArrowUp' })).toBe('Ctrl+Up');
    expect(acceleratorFromEvent({ ...base, key: 'F7' })).toBe('Ctrl+F7');
  });
});
