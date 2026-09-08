import { globalShortcut, type BrowserWindow } from 'electron';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const accelerator = 'Ctrl+Alt+Shift+F23';

export const focusSelectionFixture = async (
  window: BrowserWindow,
): Promise<void> => {
  if (
    !globalShortcut.register(accelerator, () => {
      window.show();
      window.focus();
    })
  ) {
    throw new Error('Selection smoke focus shortcut is unavailable');
  }
  try {
    await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class SelectionFocusInput {
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public InputUnion data; }
  [StructLayout(LayoutKind.Explicit)] public struct InputUnion {
    [FieldOffset(0)] public MOUSEINPUT mouse;
    [FieldOffset(0)] public KEYBDINPUT keyboard;
    [FieldOffset(0)] public HARDWAREINPUT hardware;
  }
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint flags; public uint time; public IntPtr extraInfo; }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort virtualKey; public ushort scanCode; public uint flags; public uint time; public IntPtr extraInfo; }
  [StructLayout(LayoutKind.Sequential)] public struct HARDWAREINPUT { public uint message; public ushort low; public ushort high; }
  [DllImport("user32.dll", SetLastError = true)] private static extern uint SendInput(uint count, INPUT[] inputs, int size);
  private static INPUT Key(ushort key, uint flags) { return new INPUT { type = 1, data = new InputUnion { keyboard = new KEYBDINPUT { virtualKey = key, flags = flags } } }; }
  public static uint Send() {
    INPUT[] inputs = { Key(0x11, 0), Key(0x12, 0), Key(0x10, 0), Key(0x86, 0), Key(0x86, 2), Key(0x10, 2), Key(0x12, 2), Key(0x11, 2) };
    return SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
  }
}
'@
if ([SelectionFocusInput]::Send() -ne 8) { throw 'Selection smoke input failed' }
`,
      ],
      { windowsHide: true },
    );
  } finally {
    globalShortcut.unregister(accelerator);
  }
};
