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

export const formatDuration = (durationMs: number): string => {
  if (!Number.isFinite(durationMs) || durationMs < 0) return '—';
  if (durationMs < 1_000) return `${Math.round(durationMs)} ms`;
  const seconds = durationMs / 1_000;
  return `${seconds.toFixed(seconds >= 10 ? 1 : 2).replace(/\.0+$/u, '')} s`;
};

export const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1_024) return `${Math.round(bytes)} B`;
  const kilobytes = bytes / 1_024;
  if (kilobytes < 1_024) return `${kilobytes.toFixed(1)} KB`;
  return `${(kilobytes / 1_024).toFixed(1)} MB`;
};

export const mergeHistoryPage = <Entry extends { id: string }>(
  existing: readonly Entry[],
  page: readonly Entry[],
): readonly Entry[] => {
  const seen = new Set(existing.map((entry) => entry.id));
  return [...existing, ...page.filter((entry) => !seen.has(entry.id))];
};
