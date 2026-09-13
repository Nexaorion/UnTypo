import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import {
  pasteDarwinWithHelperFallback,
  pasteOnDarwin,
} from '../../src/main/dictation/darwin-paste';
import { NativePasteStatus } from '../../src/main/native/protocol';

const target = {
  editable: true,
  higherIntegrity: false,
  processId: 4242,
  windowHandle: '1',
};

describe('pasteOnDarwin', () => {
  it('rejects UnTypo itself and invalid process ids', async () => {
    const execute = vi.fn();
    await expect(
      pasteOnDarwin(
        {
          editable: true,
          higherIntegrity: false,
          processId: process.pid,
          windowHandle: '1',
        },
        execute,
      ),
    ).resolves.toBe(NativePasteStatus.TargetChanged);
    await expect(
      pasteOnDarwin(
        {
          editable: true,
          higherIntegrity: false,
          processId: 0,
          windowHandle: '1',
        },
        execute,
      ),
    ).resolves.toBe(NativePasteStatus.TargetChanged);
    expect(execute).not.toHaveBeenCalled();
  });

  it('pastes without stealing focus when the user has switched apps', async () => {
    const execute = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });
    await expect(pasteOnDarwin(target, execute, 99)).resolves.toBe(
      NativePasteStatus.Success,
    );
    expect(execute).toHaveBeenCalledWith(
      '/usr/bin/osascript',
      [
        '-e',
        expect.stringMatching(
          /frontmost is true[\s\S]*frontUnixId is not 99[\s\S]*error "target changed" number 1001[\s\S]*unix id is 4242[\s\S]*key code 9 using command down/u,
        ),
      ],
      { timeout: 4_000 },
    );
  });

  it('maps a frontmost-app mismatch to target-changed', async () => {
    const error = Object.assign(new Error('Command failed: osascript'), {
      stderr: '0:1: execution error: target changed (1001)',
    });
    const execute = vi.fn().mockRejectedValue(error);
    await expect(pasteOnDarwin(target, execute, 99)).resolves.toBe(
      NativePasteStatus.TargetChanged,
    );
  });

  it('maps osascript failures to send-input failed', async () => {
    const execute = vi.fn().mockRejectedValue(new Error('not allowed'));
    await expect(
      pasteOnDarwin(
        {
          editable: true,
          higherIntegrity: false,
          processId: 7,
          windowHandle: '1',
        },
        execute,
      ),
    ).resolves.toBe(NativePasteStatus.SendInputFailed);
  });
});

describe('pasteDarwinWithHelperFallback', () => {
  it('keeps an AX insert that already landed', async () => {
    const keyPaste = vi.fn().mockResolvedValue(NativePasteStatus.Success);
    const helperPaste = vi.fn().mockResolvedValue(NativePasteStatus.Success);
    await expect(
      pasteDarwinWithHelperFallback(target, helperPaste, keyPaste),
    ).resolves.toBe(NativePasteStatus.Success);
    expect(keyPaste).not.toHaveBeenCalled();
  });

  it('does not send Command-V after the user has switched apps', async () => {
    const keyPaste = vi.fn().mockResolvedValue(NativePasteStatus.Success);
    const helperPaste = vi
      .fn()
      .mockResolvedValue(NativePasteStatus.TargetChanged);
    await expect(
      pasteDarwinWithHelperFallback(target, helperPaste, keyPaste),
    ).resolves.toBe(NativePasteStatus.TargetChanged);
    expect(keyPaste).not.toHaveBeenCalled();
  });

  it('sends Command-V when accessibility cannot see the focused field', async () => {
    const keyPaste = vi.fn().mockResolvedValue(NativePasteStatus.Success);
    const helperPaste = vi
      .fn()
      .mockResolvedValue(NativePasteStatus.NotEditable);
    await expect(
      pasteDarwinWithHelperFallback(target, helperPaste, keyPaste),
    ).resolves.toBe(NativePasteStatus.Success);
    expect(keyPaste).toHaveBeenCalledWith(target);
  });

  it('sends Command-V when the helper is not accessibility-trusted', async () => {
    const keyPaste = vi.fn().mockResolvedValue(NativePasteStatus.Success);
    const helperPaste = vi
      .fn()
      .mockResolvedValue(NativePasteStatus.HigherIntegrity);
    await expect(
      pasteDarwinWithHelperFallback(target, helperPaste, keyPaste),
    ).resolves.toBe(NativePasteStatus.Success);
    expect(keyPaste).toHaveBeenCalledWith(target);
  });

  it('skips the helper when capture already reported no accessibility trust', async () => {
    const keyPaste = vi.fn().mockResolvedValue(NativePasteStatus.Success);
    const helperPaste = vi.fn();
    const untrustedTarget = { ...target, higherIntegrity: true };
    await expect(
      pasteDarwinWithHelperFallback(untrustedTarget, helperPaste, keyPaste),
    ).resolves.toBe(NativePasteStatus.Success);
    expect(helperPaste).not.toHaveBeenCalled();
    expect(keyPaste).toHaveBeenCalledWith(untrustedTarget);
  });
});

describe('native macOS paste', () => {
  it('refuses to activate a captured app after the user switched away', async () => {
    const source = await readFile(
      'native/helper/src/macos/window_target.mm',
      'utf8',
    );
    expect(source).toMatch(
      /front_pid != process_id && !IsOwnProcess\(front_pid\)/u,
    );
    expect(source).toMatch(
      /front_pid != process_id && !IsOwnProcess\(front_pid\)[\s\S]*PasteStatus::TargetChanged/u,
    );
  });

  it('checks the target app focused field, not UnTypo system focus', async () => {
    const source = await readFile(
      'native/helper/src/macos/window_target.mm',
      'utf8',
    );
    expect(source).toContain('CopyFocusedElementForProcess(process_id)');
    expect(source).toContain(
      'if (!ElementIsEditable(focused)) return {PasteStatus::NotEditable};',
    );
    expect(source).toContain('InsertClipboardViaAx(focused)');
    expect(source).toContain('return {PasteStatus::SendInputFailed};');
  });
});
