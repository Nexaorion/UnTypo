import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { promisify } from 'node:util';

const require = createRequire(import.meta.url);
const {
  NativeHelperClient,
  nativeHelperFileName,
} = require('../dist/main/native/client.js');
const execFileAsync = promisify(execFile);

const executablePath = path.resolve('build/Release', nativeHelperFileName());
const client = new NativeHelperClient(executablePath);
const conflictingClient = new NativeHelperClient(executablePath);

const waitForHotkey = (targetClient) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      removeListener();
      reject(new Error('Native helper did not emit a hotkey event'));
    }, 2_000);
    const removeListener = targetClient.onHotkey((action) => {
      clearTimeout(timer);
      removeListener();
      resolve(action);
    });
  });

const sendCtrlAltShiftF24 = async () => {
  if (process.platform !== 'win32') {
    throw new Error(
      'Synthetic hotkey injection is only implemented on Windows',
    );
  }
  const script = String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class UnTypoHotkeySmoke {
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
    private static INPUT Key(ushort virtualKey, uint flags) {
        return new INPUT { type = 1, data = new InputUnion { keyboard = new KEYBDINPUT { virtualKey = virtualKey, flags = flags } } };
    }
    public static uint Send() {
        const uint keyUp = 2;
        INPUT[] inputs = new INPUT[] {
            Key(0x11, 0), Key(0x12, 0), Key(0x10, 0), Key(0x87, 0),
            Key(0x87, keyUp), Key(0x10, keyUp), Key(0x12, keyUp), Key(0x11, keyUp)
        };
        return SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
    }
}
'@
$sent = [UnTypoHotkeySmoke]::Send()
if ($sent -ne 8) { throw "SendInput delivered $sent of 8 events" }
`;
  await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    { windowsHide: true },
  );
};

const spawnOptions = process.platform === 'win32' ? { windowsHide: true } : {};

await execFileAsync(executablePath, ['--self-test'], spawnOptions);

await client.start();
await conflictingClient.start();
try {
  // F19 is mapped on both Win32 and macOS; F24 is Windows-only.
  const conflictKey = process.platform === 'win32' ? 0x87 : 0x82;
  const alternateKey = process.platform === 'win32' ? 0x86 : 0x81;
  await client.configureHotkey({
    modifiers: 0x0007,
    virtualKey: conflictKey,
  });
  let conflictDetected = false;
  try {
    await conflictingClient.configureHotkey({
      modifiers: 0x0007,
      virtualKey: conflictKey,
    });
  } catch (error) {
    conflictDetected = error?.windowsErrorCode === 1409;
  }
  if (!conflictDetected) {
    throw new Error('Native helper did not report a hotkey conflict');
  }
  if (process.platform === 'win32') {
    const hotkeyEvent = waitForHotkey(client);
    await sendCtrlAltShiftF24();
    if ((await hotkeyEvent) !== 3) {
      throw new Error('Native helper emitted an unexpected hotkey action');
    }
  }
  await conflictingClient.configureHotkey({
    modifiers: 0,
    virtualKey: alternateKey,
  });
  await client.ping();
  await conflictingClient.ping();
  const target = await client.captureTarget();
  if (!target.windowHandle || target.processId < 0) {
    throw new Error('Native helper returned an invalid target');
  }
  process.stdout.write('NATIVE_SMOKE_OK\n');
} finally {
  await Promise.all([client.stop(), conflictingClient.stop()]);
}
