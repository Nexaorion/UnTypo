import { createContext, type Context } from 'react';
import type { SupportedLanguage } from '../../core/providers/types.js';
import type { MessageKey } from './messages.js';

export type Translate = (key: MessageKey, vars?: Readonly<Record<string, string>>) => string;

export interface I18nValue {
  locale: SupportedLanguage;
  t: Translate;
}

type I18nHotData = {
  context?: Context<I18nValue | null>;
};

const createI18nContext = (): Context<I18nValue | null> => createContext<I18nValue | null>(null);

// Reuse the context object across Vite HMR so useI18n still sees I18nProvider's value.
export const I18nContext: Context<I18nValue | null> = import.meta.hot
  ? ((import.meta.hot.data as I18nHotData).context ??= createI18nContext())
  : createI18nContext();
