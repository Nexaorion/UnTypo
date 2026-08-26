import type { ClientJsonValue } from './ipc.js';

export type ClientDiagnosticIssueKind =
  'configuration' | 'internal' | 'microphone' | 'provider' | 'renderer';

export type ClientDiagnosticLevel = 'error' | 'info' | 'warning';

export interface ClientDiagnosticLogEntry {
  context?: Readonly<Record<string, ClientJsonValue>>;
  id: string;
  level: ClientDiagnosticLevel;
  message: string;
  operationId?: string;
  scope: string;
  timestamp: number;
}

export interface ClientDiagnosticError {
  message: string;
  name: string;
  stack?: string;
}

export interface ClientDiagnosticIssue {
  acknowledgedAt?: number;
  audioAvailable: boolean;
  context?: Readonly<Record<string, ClientJsonValue>>;
  error: ClientDiagnosticError;
  id: string;
  kind: ClientDiagnosticIssueKind;
  occurredAt: number;
  operationId?: string;
  source: string;
  timeline: readonly ClientDiagnosticLogEntry[];
}

export interface ClientDiagnosticSnapshot {
  generatedAt: number;
  issues: readonly ClientDiagnosticIssue[];
  privacy: {
    audioExportIsOptIn: true;
    requestBodiesCollected: false;
    secretsCollected: false;
    transcriptionTextCollected: false;
  };
  retentionDays: number;
}

export interface ClientDiagnosticExportRequest {
  includeAudio: boolean;
  issueIds: readonly string[];
}

export interface ClientDiagnosticExportResult {
  canceled: boolean;
  filePath?: string;
}

export interface ClientRendererIssueInput {
  column?: number;
  line?: number;
  message: string;
  source?: string;
  stack?: string;
}

export const DIAGNOSTIC_CHANGED_CHANNEL = 'diagnostics:changed';
