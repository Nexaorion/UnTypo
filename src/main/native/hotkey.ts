import type { NativeHotkeyConfiguration } from './protocol.js';

const MOD_ALT = 0x0001;
const MOD_CONTROL = 0x0002;
const MOD_SHIFT = 0x0004;
const MOD_WIN = 0x0008;

const namedKeys: Readonly<Record<string, number>> = {
  backspace: 0x08,
  delete: 0x2e,
  down: 0x28,
  end: 0x23,
  enter: 0x0d,
  escape: 0x1b,
  home: 0x24,
  insert: 0x2d,
  left: 0x25,
  numpad0: 0x60,
  numpad1: 0x61,
  numpad2: 0x62,
  numpad3: 0x63,
  numpad4: 0x64,
  numpad5: 0x65,
  numpad6: 0x66,
  numpad7: 0x67,
  numpad8: 0x68,
  numpad9: 0x69,
  numpadadd: 0x6b,
  numpaddecimal: 0x6e,
  numpaddivide: 0x6f,
  numpadmultiply: 0x6a,
  numpadsubtract: 0x6d,
  pagedown: 0x22,
  pageup: 0x21,
  right: 0x27,
  space: 0x20,
  tab: 0x09,
  up: 0x26,
};

const parseVirtualKey = (value: string): number => {
  const normalized = value.toLowerCase();
  if (normalized in namedKeys) return namedKeys[normalized] as number;
  if (/^[a-z0-9]$/u.test(normalized)) {
    return normalized.toUpperCase().charCodeAt(0);
  }
  const functionKey = /^f([1-9]|1\d|2[0-4])$/u.exec(normalized);
  if (functionKey) return 0x6f + Number(functionKey[1]);
  throw new Error(`Unsupported hotkey key: ${value}`);
};

export const parseHotkeyAccelerator = (
  accelerator: string,
): NativeHotkeyConfiguration => {
  const parts = accelerator
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) throw new Error('Hotkey accelerator is empty');

  if (parts.length === 1) {
    const modifierVirtualKeys: Readonly<Record<string, number>> = {
      alt: 0x12,
      option: 0x12,
    };
    const virtualKey = modifierVirtualKeys[parts[0]?.toLowerCase() ?? ''];
    if (virtualKey !== undefined) return { modifiers: 0, virtualKey };
  }

  let modifiers = 0;
  let key: string | undefined;
  for (const part of parts) {
    const normalized = part.toLowerCase();
    if (normalized === 'alt' || normalized === 'option') modifiers |= MOD_ALT;
    else if (normalized === 'ctrl' || normalized === 'control')
      modifiers |= MOD_CONTROL;
    else if (normalized === 'shift') modifiers |= MOD_SHIFT;
    else if (
      normalized === 'win' ||
      normalized === 'windows' ||
      normalized === 'super' ||
      normalized === 'meta'
    )
      modifiers |= MOD_WIN;
    else if (key) throw new Error('Hotkey accelerator has multiple keys');
    else key = part;
  }

  if (!key) throw new Error('Hotkey accelerator has no key');
  return { modifiers, virtualKey: parseVirtualKey(key) };
};
