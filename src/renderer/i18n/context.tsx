import { useCallback, useContext, useMemo, type ReactNode } from 'react';
import type { SupportedLanguage } from '../../core/providers/types.js';
import { messages } from './messages.js';
import { I18nContext, type I18nValue, type Translate } from './runtime.js';

export type { Translate };

const interpolate = (template: string, vars?: Readonly<Record<string, string>>) =>
  vars ? template.replace(/\{(\w+)\}/gu, (match, name: string) => vars[name] ?? match) : template;

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
