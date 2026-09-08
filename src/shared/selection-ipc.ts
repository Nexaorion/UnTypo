import type { SupportedLanguage } from '../core/providers/contracts.js';

export const SELECTION_CHANNELS = {
  state: 'selection:state',
  changed: 'selection:changed',
  retry: 'selection:retry',
  cancel: 'selection:cancel',
  copy: 'selection:copy',
  replace: 'selection:replace',
  close: 'selection:close',
} as const;

export type SelectionError =
  'capture' | 'provider' | 'processing' | 'replace' | 'copy' | 'busy';
export interface SelectionState {
  sessionId: string;
  locale: SupportedLanguage;
  phase: 'listening' | 'processing' | 'ready' | 'error';
  intent?: 'translation' | 'instruction';
  characters: number;
  editable: boolean;
  instruction: string;
  output: string;
  error?: SelectionError;
}

export interface SelectionAPI {
  getState: () => Promise<SelectionState>;
  onChanged: (listener: (state: SelectionState) => void) => () => void;
  retry: (sessionId: string) => Promise<void>;
  cancel: (sessionId: string) => Promise<void>;
  copy: (sessionId: string) => Promise<void>;
  replace: (sessionId: string) => Promise<void>;
  close: (sessionId: string) => Promise<void>;
}
