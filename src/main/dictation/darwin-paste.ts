import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  NativePasteStatus,
  type NativeTargetSnapshot,
} from '../native/protocol.js';

const execFileAsync = promisify(execFile);
const TARGET_CHANGED_ERROR = 1001;

const isSafeProcessId = (value: number): boolean =>
  Number.isInteger(value) && value > 0 && value <= 0x7fffffff;

const execErrorText = (error: unknown): string => {
  if (typeof error !== 'object' || error === null) return '';
  const stderr =
    'stderr' in error && typeof error.stderr === 'string' ? error.stderr : '';
  const message = error instanceof Error ? error.message : '';
  return `${stderr}\n${message}`;
};

export const pasteOnDarwin = async (
  target: NativeTargetSnapshot,
  execute: typeof execFileAsync = execFileAsync,
  ownProcessId: number = process.pid,
): Promise<NativePasteStatus> => {
  if (!isSafeProcessId(target.processId) || target.processId === ownProcessId) {
    return NativePasteStatus.TargetChanged;
  }

  const processId = String(target.processId);
  const ownId = String(ownProcessId);
  const script = `
tell application "System Events"
  set frontUnixId to unix id of first process whose frontmost is true
  if frontUnixId is not ${processId} and frontUnixId is not ${ownId} then
    error "target changed" number ${String(TARGET_CHANGED_ERROR)}
  end if
  if frontUnixId is not ${processId} then
    set matched to first process whose unix id is ${processId}
    set frontmost of matched to true
    delay 0.25
  end if
  key code 9 using command down
end tell
`;

  try {
    await execute('/usr/bin/osascript', ['-e', script], { timeout: 4_000 });
    return NativePasteStatus.Success;
  } catch (error) {
    if (
      new RegExp(`\\b${String(TARGET_CHANGED_ERROR)}\\b`, 'u').test(
        execErrorText(error),
      )
    ) {
      return NativePasteStatus.TargetChanged;
    }
    return NativePasteStatus.SendInputFailed;
  }
};

export const pasteDarwinWithHelperFallback = async (
  target: NativeTargetSnapshot,
  helperPaste: (target: NativeTargetSnapshot) => Promise<NativePasteStatus>,
  keyPaste: (
    target: NativeTargetSnapshot,
  ) => Promise<NativePasteStatus> = pasteOnDarwin,
): Promise<NativePasteStatus> => {
  if (target.higherIntegrity) return keyPaste(target);

  let helperStatus: NativePasteStatus;
  try {
    helperStatus = await helperPaste(target);
  } catch {
    helperStatus = NativePasteStatus.SendInputFailed;
  }
  if (
    helperStatus === NativePasteStatus.Success ||
    helperStatus === NativePasteStatus.TargetChanged
  ) {
    return helperStatus;
  }
  const keyStatus = await keyPaste(target);
  return keyStatus;
};
