import type { DictationIntent } from '../core/providers/contracts.js';

export const CAPSULE_CHANNELS = {
  close: 'capsule:close',
  copy: 'capsule:copy',
  result: 'capsule:result',
  setInteractive: 'capsule:set-interactive',
} as const;

export interface CapsuleResult {
  intent: DictationIntent;
  outputText: string;
}

export interface CapsuleApi {
  close: () => void;
  copy: () => void;
  onResult: (listener: (result: CapsuleResult) => void) => () => void;
  setInteractive: (interactive: boolean) => void;
}
