import type { ClientJsonValue } from '../../shared/ipc.js';

const sensitiveKeyPattern =
  /^(?:api.?key|authorization|body|bytes|cookie|credential|password|request.?body|response.?body|secret|signature|token|transcript|output.?text|clipboard|audio.?data|recording.?data)$/iu;
const bearerPattern = /\bBearer\s+[A-Za-z0-9._~+/=-]+/giu;
const apiKeyPattern = /\b(?:sk|rk|pk)-[A-Za-z0-9_-]{8,}\b/gu;
const dataUrlPattern = /data:audio\/[^,\s]+,[^\s]*/giu;
const jsonSecretPattern =
  /("(?:api.?key|authorization|cookie|password|secret|token)"\s*:\s*")[^"]*(")/giu;
const urlSecretPattern =
  /([?&](?:api.?key|access.?token|authorization|key|password|secret|token)=)[^&#\s]*/giu;
const windowsUserPathPattern = /\b([A-Za-z]:\\Users\\)[^\\\s]+/gu;
const unixUserPathPattern = /\/(?:Users|home)\/[^/\s]+/gu;
const longEncodedValuePattern = /\b[A-Za-z0-9+/=_-]{160,}\b/gu;

export const redactDiagnosticText = (value: string): string =>
  value
    .replace(bearerPattern, 'Bearer [redacted]')
    .replace(apiKeyPattern, '[redacted-api-key]')
    .replace(dataUrlPattern, 'data:audio/[redacted]')
    .replace(jsonSecretPattern, '$1[redacted]$2')
    .replace(urlSecretPattern, '$1[redacted]')
    .replace(windowsUserPathPattern, '$1[redacted]')
    .replace(unixUserPathPattern, '/home/[redacted]')
    .replace(longEncodedValuePattern, '[redacted-encoded-data]')
    .slice(0, 20_000);

const sanitizeValue = (
  value: unknown,
  depth: number,
): ClientJsonValue | undefined => {
  if (depth > 6) return '[truncated]';
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : String(value);
  }
  if (typeof value === 'string') return redactDiagnosticText(value);
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return value
      .slice(0, 100)
      .map((item) => sanitizeValue(item, depth + 1) ?? '[unsupported]');
  }
  if (typeof value !== 'object') return undefined;

  const result: Record<string, ClientJsonValue> = {};
  for (const [key, item] of Object.entries(value).slice(0, 100)) {
    if (sensitiveKeyPattern.test(key)) {
      result[key] = '[redacted]';
      continue;
    }
    const sanitized = sanitizeValue(item, depth + 1);
    if (sanitized !== undefined) result[key] = sanitized;
  }
  return result;
};

export const sanitizeDiagnosticContext = (
  value: unknown,
): Readonly<Record<string, ClientJsonValue>> | undefined => {
  const sanitized = sanitizeValue(value, 0);
  if (!sanitized || Array.isArray(sanitized) || typeof sanitized !== 'object') {
    return undefined;
  }
  return sanitized as Readonly<Record<string, ClientJsonValue>>;
};

export const sanitizeDiagnosticEndpoint = (value: string): string => {
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return redactDiagnosticText(url.toString());
  } catch {
    return redactDiagnosticText(value.split(/[?#]/u, 1)[0] ?? value);
  }
};
