const modifierAliases: Readonly<Record<string, string>> = {
  alt: 'Alt',
  cmd: 'Win',
  command: 'Win',
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
    Space: 'Space',
    Tab: 'Tab',
  };
  const mapped = map[key];
  if (mapped) return mapped;
  if (/^F([1-9]|1\d|2[0-4])$/u.test(key)) return key;
  if (/^[a-zA-Z0-9]$/u.test(key)) return key.toUpperCase();
  const named = key.toLowerCase();
  if (namedKeys.includes(named)) return keyLabel(named);
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

const physicalKeyFromCode = (code?: string): string | undefined => {
  if (!code) return undefined;
  const letter = /^Key([A-Z])$/u.exec(code);
  if (letter) return letter[1];
  const digit = /^Digit([0-9])$/u.exec(code);
  if (digit) return digit[1];
  if (code === 'Space') return 'Space';
  if (code === 'Enter' || code === 'NumpadEnter') return 'Enter';
  if (code === 'Tab') return 'Tab';
  if (code === 'Backspace') return 'Backspace';
  if (code === 'Escape') return 'Escape';
  if (code === 'Delete') return 'Delete';
  if (code === 'Home') return 'Home';
  if (code === 'End') return 'End';
  if (code === 'PageUp') return 'PageUp';
  if (code === 'PageDown') return 'PageDown';
  if (code === 'Insert') return 'Insert';
  if (code === 'ArrowUp') return 'Up';
  if (code === 'ArrowDown') return 'Down';
  if (code === 'ArrowLeft') return 'Left';
  if (code === 'ArrowRight') return 'Right';
  const functionKey = /^F([1-9]|1\d|2[0-4])$/u.exec(code);
  if (functionKey) return `F${functionKey[1]}`;
  if (numpadCodes.has(code)) return code;
  return undefined;
};

export const acceleratorFromEvent = (
  event: HotkeyCaptureEvent,
): string | undefined => {
  const key =
    physicalKeyFromCode(event.code) ??
    eventKeyToAcceleratorKey(event.key, event.code);
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
  event: Pick<HotkeyCaptureEvent, 'code' | 'key'>,
): string | undefined => {
  const fromKey = modifierAliases[event.key.toLowerCase()];
  if (fromKey) return fromKey;
  const code = event.code ?? '';
  if (code.startsWith('Control')) return 'Ctrl';
  if (code.startsWith('Alt')) return 'Alt';
  if (code.startsWith('Shift')) return 'Shift';
  if (code.startsWith('Meta')) return 'Win';
  return undefined;
};

const modifierOrder = ['Ctrl', 'Alt', 'Shift', 'Win'] as const;

export interface HotkeyCaptureSession {
  captured: boolean;
  heldModifiers: Set<string>;
  modifierChord: boolean;
  preview?: string;
}

export type HotkeyCaptureStroke = HotkeyCaptureEvent & {
  repeat?: boolean;
  type: 'keyDown' | 'keyUp';
};

export const createHotkeyCaptureSession = (): HotkeyCaptureSession => ({
  captured: false,
  heldModifiers: new Set(),
  modifierChord: false,
});

export const resetHotkeyCaptureSession = (
  session: HotkeyCaptureSession,
): void => {
  session.captured = false;
  session.heldModifiers.clear();
  session.modifierChord = false;
  session.preview = undefined;
};

const modifierPreview = (held: ReadonlySet<string>): string | undefined => {
  const preview = modifierOrder
    .filter((candidate) => held.has(candidate))
    .join('+');
  return preview.length > 0 ? preview : undefined;
};

export const applyHotkeyCaptureInput = (
  session: HotkeyCaptureSession,
  input: HotkeyCaptureStroke,
): { commit?: string } => {
  if (input.type === 'keyDown') {
    if (input.repeat) return {};
    const modifier = modifierAcceleratorFromEvent(input);
    if (modifier) {
      session.heldModifiers.add(modifier);
      if (session.heldModifiers.size > 1) session.modifierChord = true;
      session.preview = modifierPreview(session.heldModifiers);
      return {};
    }
    if (session.captured) return {};
    const accelerator = acceleratorFromEvent(input);
    if (!accelerator) return {};
    session.captured = true;
    session.preview = accelerator;
    return { commit: accelerator };
  }

  const modifier = modifierAcceleratorFromEvent(input);
  if (modifier) {
    let commit: string | undefined;
    if (
      !session.captured &&
      !session.modifierChord &&
      modifier === 'Alt' &&
      session.heldModifiers.size === 1
    ) {
      session.captured = true;
      session.preview = modifier;
      commit = modifier;
    }
    session.heldModifiers.delete(modifier);
    if (session.heldModifiers.size === 0) {
      const captured = session.captured;
      session.captured = false;
      session.modifierChord = false;
      if (!captured) session.preview = undefined;
    } else if (!session.captured) {
      session.preview = modifierPreview(session.heldModifiers);
    }
    return commit ? { commit } : {};
  }

  if (session.heldModifiers.size === 0) {
    session.captured = false;
  }
  return {};
};

export const defaultHotkeyAccelerator = (platform?: string): string =>
  platform === 'darwin' ? 'Ctrl+Shift+D' : 'Ctrl+Alt+Space';

const keycapLabels: Readonly<Record<string, string>> = {
  NumpadAdd: 'Num +',
  NumpadDecimal: 'Num .',
  NumpadDivide: 'Num /',
  NumpadMultiply: 'Num *',
  NumpadSubtract: 'Num -',
};

const darwinModifierLabels: Readonly<Record<string, string>> = {
  Alt: 'Option',
  Ctrl: 'Control',
  Shift: 'Shift',
  Win: 'Command',
};

export const formatHotkeyDisplay = (
  accelerator: string,
  platform?: string,
): string => hotkeyKeycapLabels(accelerator, platform).join(' + ');

export const hotkeyKeycapLabels = (
  accelerator: string,
  platform?: string,
): readonly string[] =>
  formatHotkeyAccelerator(accelerator)
    .split('+')
    .filter(Boolean)
    .map((part) => {
      const mapped = /^Numpad\d$/u.test(part)
        ? `Num ${part.slice(-1)}`
        : (keycapLabels[part] ?? part);
      return platform === 'darwin'
        ? (darwinModifierLabels[mapped] ?? mapped)
        : mapped;
    });
