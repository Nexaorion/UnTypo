import type {
  ClientDiagnosticExportRequest,
  ClientRendererIssueInput,
} from '../../shared/diagnostics.js';

const issueIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const assertRecord = (
  value: unknown,
  label: string,
): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value as Record<string, unknown>;
};

const assertOnlyKeys = (
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void => {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new Error(`${label} contains an unsupported field`);
  }
};

export const parseDiagnosticIssueIds = (value: unknown): readonly string[] => {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > 50 ||
    value.some((id) => typeof id !== 'string' || !issueIdPattern.test(id))
  ) {
    throw new Error('Invalid diagnostic issue ids');
  }
  return [...new Set(value as string[])];
};

export const parseDiagnosticExportRequest = (
  value: unknown,
): ClientDiagnosticExportRequest => {
  const record = assertRecord(value, 'diagnostic export request');
  assertOnlyKeys(
    record,
    ['includeAudio', 'issueIds'],
    'Diagnostic export request',
  );
  if (typeof record.includeAudio !== 'boolean') {
    throw new Error('Invalid diagnostic audio preference');
  }
  return {
    includeAudio: record.includeAudio,
    issueIds: parseDiagnosticIssueIds(record.issueIds),
  };
};

const optionalBoundedNumber = (
  value: unknown,
  maximum: number,
): number | undefined => {
  if (value === undefined) return undefined;
  if (
    !Number.isInteger(value) ||
    (value as number) < 0 ||
    (value as number) > maximum
  ) {
    throw new Error('Invalid renderer issue location');
  }
  return value as number;
};

const optionalBoundedString = (
  value: unknown,
  maximumLength: number,
): string | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > maximumLength) {
    throw new Error('Invalid renderer issue detail');
  }
  return value;
};

export const parseRendererIssue = (
  value: unknown,
): ClientRendererIssueInput => {
  const record = assertRecord(value, 'renderer issue');
  assertOnlyKeys(
    record,
    ['column', 'line', 'message', 'source', 'stack'],
    'Renderer issue',
  );
  if (
    typeof record.message !== 'string' ||
    !record.message.trim() ||
    record.message.length > 2_000
  ) {
    throw new Error('Invalid renderer issue message');
  }
  const column = optionalBoundedNumber(record.column, 10_000_000);
  const line = optionalBoundedNumber(record.line, 10_000_000);
  const source = optionalBoundedString(record.source, 2_000);
  const stack = optionalBoundedString(record.stack, 20_000);
  return {
    ...(column !== undefined ? { column } : {}),
    ...(line !== undefined ? { line } : {}),
    message: record.message.trim(),
    ...(source !== undefined ? { source } : {}),
    ...(stack !== undefined ? { stack } : {}),
  };
};
