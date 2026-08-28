import { ProviderContractError } from './contracts.js';

export interface ProviderConnectionConfiguration {
  allowInsecurePrivateEndpoint?: boolean;
  apiKey: string;
  baseUrl?: string;
  displayName: string;
  id: string;
  model: string;
}

export interface ResolvedProviderConnectionConfiguration {
  apiKey: string;
  baseUrl: string;
  displayName: string;
  id: string;
  model: string;
}

const providerIdPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const privateHostPattern =
  /^(localhost|127(?:\.\d{1,3}){3}|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|\[?::1\]?|\[?f[cd][0-9a-f:]+\]?|[^.]+\.local)$/iu;

export const normalizeProviderBaseUrl = (
  value: string,
  allowInsecurePrivateEndpoint = false,
): string => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ProviderContractError(
      'INVALID_OPTIONS',
      'Provider endpoint is not a valid URL',
    );
  }

  if (
    url.protocol !== 'https:' &&
    !(
      allowInsecurePrivateEndpoint &&
      url.protocol === 'http:' &&
      privateHostPattern.test(url.hostname)
    )
  ) {
    throw new ProviderContractError(
      'INVALID_OPTIONS',
      'Provider endpoints must use HTTPS unless explicit private-network access is enabled',
    );
  }
  if (url.username || url.password) {
    throw new ProviderContractError(
      'INVALID_OPTIONS',
      'Provider endpoints cannot contain embedded credentials',
    );
  }

  url.pathname = url.pathname.replace(/\/+$/u, '');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/u, '');
};

export const resolveProviderConfiguration = (
  configuration: ProviderConnectionConfiguration,
  defaults: { baseUrl: string; model?: string },
): ResolvedProviderConnectionConfiguration => {
  const id = configuration.id.trim();
  const displayName = configuration.displayName.trim();
  const apiKey = configuration.apiKey.trim();
  const model = configuration.model.trim() || defaults.model?.trim() || '';
  if (!providerIdPattern.test(id)) {
    throw new ProviderContractError(
      'INVALID_OPTIONS',
      'Provider id is invalid',
    );
  }
  if (!displayName || !apiKey || !model) {
    throw new ProviderContractError(
      'INVALID_OPTIONS',
      'Provider display name, API key, and model are required',
    );
  }

  return {
    apiKey,
    baseUrl: normalizeProviderBaseUrl(
      configuration.baseUrl?.trim() || defaults.baseUrl,
      configuration.allowInsecurePrivateEndpoint ?? false,
    ),
    displayName,
    id,
    model,
  };
};

export const providerUrl = (baseUrl: string, pathname: string): string =>
  `${baseUrl}${pathname.startsWith('/') ? pathname : `/${pathname}`}`;

export const isProviderEventStream = (response: Response): boolean =>
  response.headers
    .get('content-type')
    ?.toLowerCase()
    .includes('text/event-stream') ?? false;

const responseMessage = (payload: unknown): string | undefined => {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const record = payload as Record<string, unknown>;
  if (typeof record.message === 'string' && record.message.trim()) {
    return record.message;
  }
  if (typeof record.error === 'string' && record.error.trim()) {
    return record.error;
  }
  if (typeof record.error === 'object' && record.error !== null) {
    const message = (record.error as Record<string, unknown>).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return undefined;
};

const responseDetail = (
  payload: unknown,
  key: 'code' | 'request_id' | 'requestId',
): string | undefined => {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
};

const successfulErrorEnvelopeMessage = (
  payload: unknown,
): string | undefined => {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const record = payload as Record<string, unknown>;
  if (
    'error' in record &&
    record.error !== undefined &&
    record.error !== null
  ) {
    if (typeof record.error === 'object') {
      const error = record.error as Record<string, unknown>;
      for (const value of [error.message, error.code, error.type]) {
        if (typeof value === 'string' && value.trim()) return value;
      }
    }
    return responseMessage(payload) ?? 'Provider returned an error response';
  }

  const code = record.code;
  if (
    (typeof code === 'string' && code.trim() && code !== '0') ||
    (typeof code === 'number' && code !== 0 && code !== 200)
  ) {
    return responseMessage(payload) ?? String(code);
  }
  return undefined;
};

export const readProviderJson = async (
  response: Response,
  providerName: string,
): Promise<unknown> => {
  const source = await response.text();
  let payload: unknown = {};
  let rawErrorBody: string | undefined;
  if (source) {
    try {
      payload = JSON.parse(source) as unknown;
    } catch {
      if (response.ok) {
        throw new ProviderContractError(
          'INVALID_PROVIDER',
          `${providerName} returned invalid JSON`,
        );
      }
      rawErrorBody = source.replace(/\s+/gu, ' ').trim().slice(0, 500);
    }
  }

  if (!response.ok) {
    const code = responseDetail(payload, 'code');
    const message = responseMessage(payload);
    const requestId =
      responseDetail(payload, 'request_id') ??
      responseDetail(payload, 'requestId') ??
      response.headers.get('x-request-id')?.trim() ??
      response.headers.get('x-dashscope-request-id')?.trim();
    const details = [
      code ? `code ${code}` : undefined,
      message,
      requestId ? `request_id ${requestId}` : undefined,
      rawErrorBody ? `response ${rawErrorBody}` : undefined,
    ].filter((detail): detail is string => Boolean(detail));
    throw new Error(
      `${providerName} request failed with status ${String(response.status)}${
        details.length > 0 ? `: ${details.join(', ')}` : ''
      }`,
    );
  }
  const envelopeError = successfulErrorEnvelopeMessage(payload);
  if (envelopeError) {
    throw new Error(`${providerName} returned an error: ${envelopeError}`);
  }
  return payload;
};

const streamErrorMessage = (event: unknown): string | undefined => {
  if (typeof event !== 'object' || event === null) return undefined;
  const record = event as Record<string, unknown>;
  const error =
    typeof record.error === 'object' && record.error !== null
      ? (record.error as Record<string, unknown>)
      : typeof record.response === 'object' && record.response !== null
        ? ((record.response as Record<string, unknown>).error as
            Record<string, unknown> | undefined)
        : undefined;
  if (
    (record.type === 'error' || record.type === 'response.failed') &&
    typeof error?.message === 'string' &&
    error.message.trim()
  ) {
    return error.message.trim();
  }
  return undefined;
};

export const readProviderEventStream = async (
  response: Response,
  providerName: string,
  onEvent: (event: unknown) => void,
): Promise<void> => {
  if (!response.ok) {
    await readProviderJson(response, providerName);
    return;
  }
  if (!response.body) {
    throw new ProviderContractError(
      'INVALID_PROVIDER',
      `${providerName} returned an empty event stream`,
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let source = '';

  const processFrame = (frame: string): void => {
    const data = frame
      .split(/\r?\n/u)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).replace(/^ /u, ''))
      .join('\n');
    if (!data || data === '[DONE]') return;

    let event: unknown;
    try {
      event = JSON.parse(data) as unknown;
    } catch {
      throw new ProviderContractError(
        'INVALID_PROVIDER',
        `${providerName} returned an invalid event stream`,
      );
    }
    const error = streamErrorMessage(event);
    if (error) throw new Error(`${providerName} returned an error: ${error}`);
    onEvent(event);
  };

  const drainFrames = (complete: boolean): void => {
    while (true) {
      const match = /\r?\n\r?\n/u.exec(source);
      if (!match || match.index === undefined) break;
      const frame = source.slice(0, match.index);
      source = source.slice(match.index + match[0].length);
      processFrame(frame);
    }
    if (complete && source.trim()) {
      processFrame(source);
      source = '';
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      source += decoder.decode(value, { stream: true });
      drainFrames(false);
    }
    source += decoder.decode();
    drainFrames(true);
  } finally {
    reader.releaseLock();
  }
};

export const providerConfigSchema = {
  additionalProperties: false,
  properties: {
    allowInsecurePrivateEndpoint: { type: 'boolean' },
    apiKey: { format: 'password', title: 'API Key', type: 'string' },
    baseUrl: { format: 'uri', title: 'Base URL', type: 'string' },
    displayName: { title: 'Display name', type: 'string' },
    id: { title: 'ID', type: 'string' },
    model: { title: 'Model', type: 'string' },
  },
  required: ['id', 'displayName', 'apiKey', 'model'],
  type: 'object',
} as const;
