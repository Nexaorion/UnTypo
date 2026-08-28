import type { ClientDiagnosticIssue } from '../../shared/diagnostics.js';

export const diagnosticKindKey = (kind: ClientDiagnosticIssue['kind']) => {
  if (kind === 'provider') return 'diagnostics.kind.provider' as const;
  if (kind === 'microphone') return 'diagnostics.kind.microphone' as const;
  if (kind === 'configuration')
    return 'diagnostics.kind.configuration' as const;
  if (kind === 'renderer') return 'diagnostics.kind.renderer' as const;
  return 'diagnostics.kind.internal' as const;
};

export const latestDiagnosticIssue = (
  issues: readonly ClientDiagnosticIssue[],
): ClientDiagnosticIssue | undefined => issues[0];
