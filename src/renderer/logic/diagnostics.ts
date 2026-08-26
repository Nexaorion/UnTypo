import type { ClientDiagnosticIssue } from '../../shared/diagnostics.js';

export const latestDiagnosticIssue = (
  issues: readonly ClientDiagnosticIssue[],
): ClientDiagnosticIssue | undefined => issues[0];
