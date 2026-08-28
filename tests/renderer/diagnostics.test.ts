import { describe, expect, it } from 'vitest';
import type { ClientDiagnosticIssue } from '../../src/shared/diagnostics';
import {
  diagnosticKindKey,
  latestDiagnosticIssue,
} from '../../src/renderer/logic/diagnostics';

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

  it('maps every issue kind to localized copy', () => {
    expect(diagnosticKindKey('provider')).toBe('diagnostics.kind.provider');
    expect(diagnosticKindKey('renderer')).toBe('diagnostics.kind.renderer');
  });
});
