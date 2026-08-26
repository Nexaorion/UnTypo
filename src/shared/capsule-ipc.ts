import type {
  DictationIntent,
  SupportedLanguage,
} from '../core/providers/contracts.js';

export const CAPSULE_CHANNELS = {
  close: 'capsule:close',
  copy: 'capsule:copy',
  ready: 'capsule:ready',
  setInteractive: 'capsule:set-interactive',
  update: 'capsule:update',
} as const;

export type CapsuleErrorReason =
  | 'configuration'
  | 'empty'
  | 'microphone'
  | 'no-speech'
  | 'provider'
  | 'unknown';

export type CapsuleStatus =
  | {
      level: number;
      locale: SupportedLanguage;
      type: 'recording';
    }
  | {
      locale: SupportedLanguage;
      type: 'processing';
    }
  | {
      delivery: 'copy' | 'inserted';
      intent: DictationIntent;
      locale: SupportedLanguage;
      outputText: string;
      type: 'success';
    }
  | {
      detail?: string;
      locale: SupportedLanguage;
      reason: CapsuleErrorReason;
      type: 'error';
    };

export interface CapsuleApi {
  close: () => void;
  copy: () => void;
  onUpdate: (listener: (status: CapsuleStatus) => void) => () => void;
  ready: () => void;
  setInteractive: (interactive: boolean) => void;
}
