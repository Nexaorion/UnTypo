import { describe, expect, it } from 'vitest';
import { parseHotkeyAccelerator } from '../../src/main/native/hotkey';
import {
  acceleratorFromEvent,
  formatHotkeyAccelerator,
  hotkeyKeycapLabels,
  isValidHotkeyAccelerator,
  modifierAcceleratorFromEvent,
} from '../../src/renderer/logic/hotkey';

const accepted = [
  'Ctrl+Shift+Space',
  'Alt+F4',
  'Win+K',
  'Alt',
  'Ctrl+0',
  'Ctrl+1',
  'Ctrl+Numpad0',
  'Escape',
  'Ctrl+Alt+Shift+Win+PageDown',
  'F24',
];

const rejected = ['', 'Ctrl', 'Ctrl+Shift', 'Ctrl+A+B', 'Ctrl+F25', 'Ctrl+Ok'];

describe('isValidHotkeyAccelerator', () => {
  it('agrees with the main-process parser on accepted accelerators', () => {
    for (const accelerator of accepted) {
      expect(isValidHotkeyAccelerator(accelerator)).toBe(true);
      expect(() => parseHotkeyAccelerator(accelerator)).not.toThrow();
    }
  });

  it('agrees with the main-process parser on rejected accelerators', () => {
    for (const accelerator of rejected) {
      expect(isValidHotkeyAccelerator(accelerator)).toBe(false);
      expect(() => parseHotkeyAccelerator(accelerator)).toThrow();
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

  it('distinguishes the number row from the numeric keypad', () => {
    const base = {
      altKey: false,
      ctrlKey: true,
      key: '0',
      metaKey: false,
      shiftKey: false,
    };
    expect(acceleratorFromEvent({ ...base, code: 'Digit0' })).toBe('Ctrl+0');
    expect(acceleratorFromEvent({ ...base, code: 'Numpad0' })).toBe(
      'Ctrl+Numpad0',
    );
  });

  it('identifies modifiers for keyup-only Alt capture', () => {
    expect(modifierAcceleratorFromEvent({ key: 'Alt' })).toBe('Alt');
    expect(modifierAcceleratorFromEvent({ key: 'Control' })).toBe('Ctrl');
  });
});

describe('hotkeyKeycapLabels', () => {
  it('creates display labels without changing the stored accelerator', () => {
    expect(hotkeyKeycapLabels('Ctrl+0')).toEqual(['Ctrl', '0']);
    expect(hotkeyKeycapLabels('Ctrl+Numpad0')).toEqual(['Ctrl', 'Num 0']);
  });
});
