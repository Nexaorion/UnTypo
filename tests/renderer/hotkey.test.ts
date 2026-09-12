import { describe, expect, it } from 'vitest';
import { parseHotkeyAccelerator } from '../../src/main/native/hotkey';
import {
  acceleratorFromEvent,
  applyHotkeyCaptureInput,
  createHotkeyCaptureSession,
  defaultHotkeyAccelerator,
  formatHotkeyAccelerator,
  formatHotkeyDisplay,
  hotkeyKeycapLabels,
  isValidHotkeyAccelerator,
  modifierAcceleratorFromEvent,
} from '../../src/renderer/logic/hotkey';

const accepted = [
  'Ctrl+Shift+Space',
  'Ctrl+Shift+D',
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

describe('hotkeyKeycapLabels', () => {
  it('keeps Windows modifier names by default', () => {
    expect(hotkeyKeycapLabels('Ctrl+Alt+Space')).toEqual([
      'Ctrl',
      'Alt',
      'Space',
    ]);
  });

  it('uses macOS modifier names when the platform is darwin', () => {
    expect(hotkeyKeycapLabels('Ctrl+Alt+Space', 'darwin')).toEqual([
      'Control',
      'Option',
      'Space',
    ]);
    expect(hotkeyKeycapLabels('Win+K', 'darwin')).toEqual(['Command', 'K']);
    expect(formatHotkeyDisplay('Ctrl+Alt+Space', 'darwin')).toBe(
      'Control + Option + Space',
    );
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
    expect(modifierAcceleratorFromEvent({ code: 'AltLeft', key: 'Dead' })).toBe(
      'Alt',
    );
    expect(
      modifierAcceleratorFromEvent({ code: 'MetaLeft', key: 'Meta' }),
    ).toBe('Win');
  });

  it('uses the physical key code when Option remaps event.key on macOS', () => {
    expect(
      acceleratorFromEvent({
        altKey: true,
        code: 'KeyD',
        ctrlKey: true,
        key: '∂',
        metaKey: false,
        shiftKey: false,
      }),
    ).toBe('Ctrl+Alt+D');
    expect(
      acceleratorFromEvent({
        altKey: true,
        code: 'Space',
        ctrlKey: true,
        key: ' ',
        metaKey: false,
        shiftKey: false,
      }),
    ).toBe('Ctrl+Alt+Space');
  });

  it('accepts Electron before-input-event key names', () => {
    expect(
      acceleratorFromEvent({
        altKey: true,
        code: 'Space',
        ctrlKey: true,
        key: 'Space',
        metaKey: false,
        shiftKey: false,
      }),
    ).toBe('Ctrl+Alt+Space');
  });
});

describe('applyHotkeyCaptureInput', () => {
  it('commits Control+Option then Space from main-process input', () => {
    const session = createHotkeyCaptureSession();
    applyHotkeyCaptureInput(session, {
      altKey: false,
      code: 'ControlLeft',
      ctrlKey: true,
      key: 'Control',
      metaKey: false,
      shiftKey: false,
      type: 'keyDown',
    });
    applyHotkeyCaptureInput(session, {
      altKey: true,
      code: 'AltLeft',
      ctrlKey: true,
      key: 'Alt',
      metaKey: false,
      shiftKey: false,
      type: 'keyDown',
    });
    expect(session.preview).toBe('Ctrl+Alt');
    const { commit } = applyHotkeyCaptureInput(session, {
      altKey: true,
      code: 'Space',
      ctrlKey: true,
      key: 'Space',
      metaKey: false,
      shiftKey: false,
      type: 'keyDown',
    });
    expect(commit).toBe('Ctrl+Alt+Space');
    expect(session.preview).toBe('Ctrl+Alt+Space');
  });

  it('commits a letter remapped by Option and keeps the preview after release', () => {
    const session = createHotkeyCaptureSession();
    applyHotkeyCaptureInput(session, {
      altKey: false,
      code: 'ControlLeft',
      ctrlKey: true,
      key: 'Control',
      metaKey: false,
      shiftKey: false,
      type: 'keyDown',
    });
    applyHotkeyCaptureInput(session, {
      altKey: true,
      code: 'AltLeft',
      ctrlKey: true,
      key: 'Alt',
      metaKey: false,
      shiftKey: false,
      type: 'keyDown',
    });
    const { commit } = applyHotkeyCaptureInput(session, {
      altKey: true,
      code: 'KeyD',
      ctrlKey: true,
      key: '∂',
      metaKey: false,
      shiftKey: false,
      type: 'keyDown',
    });
    expect(commit).toBe('Ctrl+Alt+D');
    applyHotkeyCaptureInput(session, {
      altKey: true,
      code: 'KeyD',
      ctrlKey: true,
      key: '∂',
      metaKey: false,
      shiftKey: false,
      type: 'keyUp',
    });
    applyHotkeyCaptureInput(session, {
      altKey: false,
      code: 'AltLeft',
      ctrlKey: true,
      key: 'Alt',
      metaKey: false,
      shiftKey: false,
      type: 'keyUp',
    });
    applyHotkeyCaptureInput(session, {
      altKey: false,
      code: 'ControlLeft',
      ctrlKey: false,
      key: 'Control',
      metaKey: false,
      shiftKey: false,
      type: 'keyUp',
    });
    expect(session.preview).toBe('Ctrl+Alt+D');
  });

  it('clears a modifier-only chord that never received a key', () => {
    const session = createHotkeyCaptureSession();
    applyHotkeyCaptureInput(session, {
      altKey: false,
      code: 'ControlLeft',
      ctrlKey: true,
      key: 'Control',
      metaKey: false,
      shiftKey: false,
      type: 'keyDown',
    });
    applyHotkeyCaptureInput(session, {
      altKey: true,
      code: 'AltLeft',
      ctrlKey: true,
      key: 'Alt',
      metaKey: false,
      shiftKey: false,
      type: 'keyDown',
    });
    applyHotkeyCaptureInput(session, {
      altKey: false,
      code: 'AltLeft',
      ctrlKey: true,
      key: 'Alt',
      metaKey: false,
      shiftKey: false,
      type: 'keyUp',
    });
    applyHotkeyCaptureInput(session, {
      altKey: false,
      code: 'ControlLeft',
      ctrlKey: false,
      key: 'Control',
      metaKey: false,
      shiftKey: false,
      type: 'keyUp',
    });
    expect(session.preview).toBeUndefined();
  });
});

describe('defaultHotkeyAccelerator', () => {
  it('avoids Apple-reserved Space shortcuts on macOS', () => {
    expect(defaultHotkeyAccelerator('darwin')).toBe('Ctrl+Shift+D');
    expect(defaultHotkeyAccelerator('win32')).toBe('Ctrl+Alt+Space');
  });
});

describe('acceleratorFromEvent', () => {
  it('uses the logical key for alternate keyboard layouts', () => {
    expect(
      acceleratorFromEvent({
        code: 'KeyZ',
        ctrlKey: true,
        key: 'y',
        altKey: false,
        metaKey: false,
        shiftKey: false,
      }),
    ).toBe('Ctrl+Y');
  });
});

describe('hotkeyKeycapLabels', () => {
  it('creates display labels without changing the stored accelerator', () => {
    expect(hotkeyKeycapLabels('Ctrl+0')).toEqual(['Ctrl', '0']);
    expect(hotkeyKeycapLabels('Ctrl+Numpad0')).toEqual(['Ctrl', 'Num 0']);
  });
});
