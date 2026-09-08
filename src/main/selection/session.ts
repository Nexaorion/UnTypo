import { randomUUID } from 'node:crypto';
import type {
  SupportedLanguage,
  ProcessResult,
  TextGenerationProvider,
} from '../../core/providers/contracts.js';
import type {
  SelectionError,
  SelectionState,
} from '../../shared/selection-ipc.js';
import type { NativeSelection } from '../native/protocol.js';

export interface SelectionContext {
  locale: SupportedLanguage;
  defaultTargetLanguage: SupportedLanguage;
  provider?: TextGenerationProvider;
}

export const parseSelectionAction = (value: unknown): { sessionId: string } => {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('sessionId' in value) ||
    typeof value.sessionId !== 'string' ||
    !/^[a-f0-9-]{36}$/u.test(value.sessionId)
  ) {
    throw new Error('Invalid selection session');
  }
  if (Object.keys(value).some((key) => key !== 'sessionId'))
    throw new Error('Invalid selection action');
  return { sessionId: value.sessionId };
};

export class SelectionSession {
  readonly #publish: (state: SelectionState) => void;
  #text = '';
  #abort?: AbortController;
  #state: SelectionState;

  constructor(
    locale: SupportedLanguage,
    publish: (state: SelectionState) => void,
  ) {
    this.#publish = publish;
    this.#state = {
      sessionId: randomUUID(),
      locale,
      phase: 'listening',
      characters: 0,
      editable: false,
      instruction: '',
      output: '',
    };
  }

  get state(): SelectionState {
    return { ...this.#state };
  }

  showResult(result: ProcessResult): void {
    this.update({
      phase: 'ready',
      instruction: result.rawTranscript ?? '',
      output: result.outputText,
      intent: result.intent === 'translation' ? 'translation' : 'instruction',
    });
  }

  capture(selection: NativeSelection): void {
    if (!selection.text.trim() || selection.text.length > 20_000) {
      this.fail('capture');
      return;
    }
    this.#text = selection.text;
    this.update({
      characters: selection.text.length,
      editable: selection.editable,
    });
  }

  fail(error: SelectionError): void {
    this.update({
      phase: 'error',
      error,
      ...(error === 'processing' ? { output: '' } : {}),
    });
  }

  async run(instruction: string, context: SelectionContext): Promise<void> {
    if (!this.#text || this.#abort) return;
    this.update({
      instruction,
      intent: undefined,
      output: '',
      error: undefined,
    });
    if (!instruction.trim() || instruction.length > 20_000) {
      this.fail('processing');
      return;
    }
    if (!context.provider) {
      this.fail('provider');
      return;
    }
    const abort = new AbortController();
    this.#abort = abort;
    this.update({
      phase: 'processing',
      instruction,
      output: '',
      error: undefined,
    });
    const timer = setTimeout(() => abort.abort(), 60_000);
    try {
      const result = await context.provider.processTranscript(this.#text, {
        defaultTargetLanguage: context.defaultTargetLanguage,
        dictionary: [],
        locale: context.locale,
        selectionInstruction: instruction,
        signal: abort.signal,
        onOutputTextUpdate: (output) => {
          if (this.#abort === abort && !abort.signal.aborted)
            this.update({ output: output.slice(0, 100_000) });
        },
      });
      if (this.#abort !== abort) return;
      if (
        abort.signal.aborted ||
        !result.outputText.trim() ||
        result.outputText.length > 100_000
      ) {
        this.fail('processing');
      } else {
        this.update({
          phase: 'ready',
          output: result.outputText,
          intent:
            result.intent === 'translation' ? 'translation' : 'instruction',
        });
      }
    } catch {
      if (this.#abort === abort) this.fail('processing');
    } finally {
      clearTimeout(timer);
      if (this.#abort === abort) this.#abort = undefined;
    }
  }

  cancel(): void {
    this.#abort?.abort();
    this.#abort = undefined;
    this.update({ phase: 'listening', output: '', error: undefined });
  }

  dispose(): void {
    this.#abort?.abort();
    this.#abort = undefined;
    this.#text = '';
    this.#state = {
      ...this.#state,
      output: '',
      instruction: '',
      characters: 0,
    };
  }

  private update(value: Partial<SelectionState>): void {
    this.#state = { ...this.#state, ...value };
    this.#publish(this.state);
  }
}
