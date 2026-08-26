const modifierAliases: Readonly<Record<string, string>> = {
  alt: 'Alt',
  control: 'Ctrl',
  ctrl: 'Ctrl',
  meta: 'Win',
  option: 'Alt',
  shift: 'Shift',
  super: 'Win',
  win: 'Win',
  windows: 'Win',
};

const namedKeys: readonly string[] = [
  'backspace',
  'delete',
  'down',
  'end',
  'enter',
  'escape',
  'home',
  'insert',
  'left',
  'numpad0',
  'numpad1',
  'numpad2',
  'numpad3',
  'numpad4',
  'numpad5',
  'numpad6',
  'numpad7',
  'numpad8',
  'numpad9',
  'numpadadd',
  'numpaddecimal',
  'numpaddivide',
  'numpadmultiply',
  'numpadsubtract',
  'pagedown',
  'pageup',
  'right',
  'space',
  'tab',
  'up',
];

const namedKeyLabels: Readonly<Record<string, string>> = {
  backspace: 'Backspace',
  delete: 'Delete',
  down: 'Down',
  end: 'End',
  enter: 'Enter',
  escape: 'Escape',
  home: 'Home',
  insert: 'Insert',
  left: 'Left',
  numpad0: 'Numpad0',
  numpad1: 'Numpad1',
  numpad2: 'Numpad2',
  numpad3: 'Numpad3',
  numpad4: 'Numpad4',
  numpad5: 'Numpad5',
  numpad6: 'Numpad6',
  numpad7: 'Numpad7',
  numpad8: 'Numpad8',
  numpad9: 'Numpad9',
  numpadadd: 'NumpadAdd',
  numpaddecimal: 'NumpadDecimal',
  numpaddivide: 'NumpadDivide',
  numpadmultiply: 'NumpadMultiply',
  numpadsubtract: 'NumpadSubtract',
  pagedown: 'PageDown',
  pageup: 'PageUp',
  right: 'Right',
  space: 'Space',
  tab: 'Tab',
  up: 'Up',
};

const isSupportedKey = (value: string): boolean =>
  namedKeys.includes(value) ||
  /^[a-z0-9]$/u.test(value) ||
  /^f([1-9]|1\d|2[0-4])$/u.test(value);

const keyLabel = (value: string): string =>
  namedKeyLabels[value] ??
  (/^f\d{1,2}$/u.test(value) ? value.toUpperCase() : value.toUpperCase());

export const HOTKEY_MAX_LENGTH = 128;

/** Mirrors main/native/hotkey.ts so invalid input is rejected before IPC. */
export const isValidHotkeyAccelerator = (accelerator: string): boolean => {
  if (accelerator.length === 0 || accelerator.length > HOTKEY_MAX_LENGTH) {
    return false;
  }
  const parts = accelerator
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return false;
  if (
    parts.length === 1 &&
    modifierAliases[parts[0]?.toLowerCase() ?? ''] === 'Alt'
  ) {
    return true;
  }

  let key: string | undefined;
  for (const part of parts) {
    const normalized = part.toLowerCase();
    if (normalized in modifierAliases) continue;
    if (key !== undefined) return false;
    key = normalized;
  }
  return key !== undefined && isSupportedKey(key);
};

export const formatHotkeyAccelerator = (accelerator: string): string => {
  const parts = accelerator
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean);
  const modifiers: string[] = [];
  let key = '';

  for (const part of parts) {
    const normalized = part.toLowerCase();
    const alias = modifierAliases[normalized];
    if (alias) {
      if (!modifiers.includes(alias)) modifiers.push(alias);
      continue;
    }
    key = keyLabel(normalized);
  }

  const order = ['Ctrl', 'Alt', 'Shift', 'Win'];
  modifiers.sort((left, right) => order.indexOf(left) - order.indexOf(right));
  return [...modifiers, key].filter(Boolean).join('+');
};

const numpadCodes = new Set([
  'Numpad0',
  'Numpad1',
  'Numpad2',
  'Numpad3',
  'Numpad4',
  'Numpad5',
  'Numpad6',
  'Numpad7',
  'Numpad8',
  'Numpad9',
  'NumpadAdd',
  'NumpadDecimal',
  'NumpadDivide',
  'NumpadMultiply',
  'NumpadSubtract',
]);

const eventKeyToAcceleratorKey = (
  key: string,
  code?: string,
): string | undefined => {
  if (code && numpadCodes.has(code)) return code;
  const map: Readonly<Record<string, string>> = {
    ' ': 'Space',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    ArrowUp: 'Up',
    Backspace: 'Backspace',
    Delete: 'Delete',
    End: 'End',
    Enter: 'Enter',
    Escape: 'Escape',
    Home: 'Home',
    Insert: 'Insert',
    PageDown: 'PageDown',
    PageUp: 'PageUp',
    Tab: 'Tab',
  };
  const mapped = map[key];
  if (mapped) return mapped;
  if (/^F([1-9]|1\d|2[0-4])$/u.test(key)) return key;
  if (/^[a-zA-Z0-9]$/u.test(key)) return key.toUpperCase();
  return undefined;
};

export interface HotkeyCaptureEvent {
  altKey: boolean;
  code?: string;
  ctrlKey: boolean;
  key: string;
  metaKey: boolean;
  shiftKey: boolean;
}

/** Returns undefined while only modifiers are held, so capture stays open. */
export const acceleratorFromEvent = (
  event: HotkeyCaptureEvent,
): string | undefined => {
  const key = eventKeyToAcceleratorKey(event.key, event.code);
  if (key === undefined) return undefined;

  const parts: string[] = [];
  if (event.ctrlKey) parts.push('Ctrl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  if (event.metaKey) parts.push('Win');
  parts.push(key);
  return parts.join('+');
};

export const modifierAcceleratorFromEvent = (
  event: Pick<HotkeyCaptureEvent, 'key'>,
): string | undefined => modifierAliases[event.key.toLowerCase()];

const keycapLabels: Readonly<Record<string, string>> = {
  NumpadAdd: 'Num +',
  NumpadDecimal: 'Num .',
  NumpadDivide: 'Num /',
  NumpadMultiply: 'Num *',
  NumpadSubtract: 'Num -',
};

/** Returns presentation-only labels; persisted accelerators remain canonical. */
export const hotkeyKeycapLabels = (accelerator: string): readonly string[] =>
  formatHotkeyAccelerator(accelerator)
    .split('+')
    .filter(Boolean)
    .map((part) =>
      /^Numpad\d$/u.test(part)
        ? `Num ${part.slice(-1)}`
        : (keycapLabels[part] ?? part),
    );
