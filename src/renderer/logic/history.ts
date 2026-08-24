import type { SupportedLanguage } from '../../core/providers/contracts.js';

export const HISTORY_PAGE_SIZE = 30;

export const formatTimestamp = (
  createdAt: number,
  locale: SupportedLanguage,
): string => {
  if (!Number.isFinite(createdAt)) return '';
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(createdAt));
};

export const mergeHistoryPage = <Entry extends { id: string }>(
  existing: readonly Entry[],
  page: readonly Entry[],
): readonly Entry[] => {
  const seen = new Set(existing.map((entry) => entry.id));
  return [...existing, ...page.filter((entry) => !seen.has(entry.id))];
};
