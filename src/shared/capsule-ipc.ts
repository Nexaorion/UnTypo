import type {
  DictationIntent,
  SupportedLanguage,
} from '../core/providers/contracts.js';

export const CAPSULE_CHANNELS = {
  close: 'capsule:close',
  confirm: 'capsule:confirm',
  copy: 'capsule:copy',
  dictionaryAccept: 'capsule:dictionary-accept',
  dictionaryFocus: 'capsule:dictionary-focus',
  dictionaryReject: 'capsule:dictionary-reject',
  ready: 'capsule:ready',
  reject: 'capsule:reject',
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

export type DictionarySuggestionError =
  'duplicate' | 'empty' | 'full' | 'too-long' | 'unavailable';

export type CapsuleStatus =
  | {
      level: number;
      locale: SupportedLanguage;
      type: 'recording';
    }
  | {
      locale: SupportedLanguage;
      outputText?: string;
      type: 'processing';
    }
  | {
      intent: DictationIntent;
      locale: SupportedLanguage;
      outputText: string;
      rawTranscript: string;
      type: 'confirm';
    }
  | {
      delivery: 'copy' | 'inserted';
      intent: DictationIntent;
      locale: SupportedLanguage;
      outputText: string;
      type: 'success';
    }
  | {
      error?: DictionarySuggestionError;
      locale: SupportedLanguage;
      submitting?: boolean;
      term: string;
      type: 'dictionary-suggestion';
    }
  | {
      detail?: string;
      locale: SupportedLanguage;
      reason: CapsuleErrorReason;
      type: 'error';
    };

export interface CapsuleApi {
  close: () => void;
  confirm: () => void;
  copy: () => void;
  dictionaryAccept: (term: string) => void;
  dictionaryFocus: () => void;
  dictionaryReject: () => void;
  onUpdate: (listener: (status: CapsuleStatus) => void) => () => void;
  ready: () => void;
  reject: () => void;
  setInteractive: (interactive: boolean) => void;
}
