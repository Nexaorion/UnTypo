import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from 'react';
import type { SupportedLanguage } from '../../core/providers/contracts.js';
import { messages, type MessageKey } from './messages.js';

export type Translate = (
  key: MessageKey,
  vars?: Readonly<Record<string, string>>,
) => string;

interface I18nValue {
  locale: SupportedLanguage;
  t: Translate;
}

const I18nContext = createContext<I18nValue | null>(null);

const interpolate = (
  template: string,
  vars?: Readonly<Record<string, string>>,
) =>
  vars
    ? template.replace(
        /\{(\w+)\}/gu,
        (match, name: string) => vars[name] ?? match,
      )
    : template;

export const I18nProvider = ({
  children,
  locale,
}: {
  children: ReactNode;
  locale: SupportedLanguage;
}) => {
  const t = useCallback<Translate>(
    (key, vars) => interpolate(messages[locale][key], vars),
    [locale],
  );
  const value = useMemo<I18nValue>(() => ({ locale, t }), [locale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export const useI18n = (): I18nValue => {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n requires I18nProvider');
  return value;
};
