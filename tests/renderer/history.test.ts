import { describe, expect, it } from 'vitest';
import {
  formatBytes,
  formatDuration,
  formatTimestamp,
  mergeHistoryPage,
} from '../../src/renderer/logic/history';

describe('formatDuration', () => {
  it('keeps sub-second timings readable and short', () => {
    expect(formatDuration(729)).toBe('729 ms');
    expect(formatDuration(23_073)).toBe('23.1 s');
    expect(formatDuration(Number.NaN)).toBe('—');
  });
});

describe('formatBytes', () => {
  it('formats audio payload sizes without exposing payload contents', () => {
    expect(formatBytes(800)).toBe('800 B');
    expect(formatBytes(2_048)).toBe('2.0 KB');
  });
});

describe('formatTimestamp', () => {
  it('returns an empty string for a non-finite timestamp', () => {
    expect(formatTimestamp(Number.NaN, 'zh-CN')).toBe('');
  });

  it('formats an epoch timestamp for the locale', () => {
    const createdAt = Date.UTC(2026, 0, 2, 3, 4, 5);
    expect(formatTimestamp(createdAt, 'en-US')).toMatch(/\d{2}\/\d{2}\/\d{4}/u);
    expect(formatTimestamp(createdAt, 'zh-CN')).toMatch(/2026/u);
  });
});

describe('mergeHistoryPage', () => {
  it('appends new records and skips ids already loaded', () => {
    const merged = mergeHistoryPage(
      [{ id: 'a' }, { id: 'b' }],
      [{ id: 'b' }, { id: 'c' }],
    );
    expect(merged).toEqual([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
  });
});
