import { describe, expect, it } from 'vitest';
import type { ClientDiagnosticIssue } from '../../src/shared/diagnostics';
import { latestDiagnosticIssue } from '../../src/renderer/logic/diagnostics';

const issue = (id: string, occurredAt: number): ClientDiagnosticIssue => ({
  audioAvailable: false,
  error: { message: id, name: 'Error' },
  id,
  kind: 'internal',
  occurredAt,
  source: 'test',
  timeline: [],
});

describe('latestDiagnosticIssue', () => {
  it('uses only the first, newest issue from the diagnostic snapshot', () => {
    const latest = issue('latest', 2);
    const previous = issue('previous', 1);

    expect(latestDiagnosticIssue([latest, previous])).toBe(latest);
  });

  it('returns no issue for an empty snapshot', () => {
    expect(latestDiagnosticIssue([])).toBeUndefined();
  });
});
