import type { ClientProviderInput } from '../../shared/ipc.js';

export const PROFILE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/u;

export const PROVIDER_LIMITS = {
  apiKey: 16_384,
  baseUrl: 2_048,
  model: 200,
} as const;

// Mirrors the private-host allowance in core/providers/openai-provider.ts.
const privateHostPattern =
  /^(localhost|127(?:\.\d{1,3}){3}|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|\[?::1\]?|\[?f[cd][0-9a-f:]+\]?|[^.]+\.local)$/iu;

export interface ProviderFormState {
  allowInsecurePrivateEndpoint: boolean;
  apiKey: string;
  baseUrl: string;
  id: string;
  textModel: string;
  transcriptionModel: string;
}

export type ProviderFormField =
  'apiKey' | 'baseUrl' | 'id' | 'textModel' | 'transcriptionModel';

export type ProviderFormErrorCode =
  'insecureUrl' | 'invalidId' | 'invalidUrl' | 'required' | 'tooLong';

export type ProviderFormErrors = Partial<
  Record<ProviderFormField, ProviderFormErrorCode>
>;

export const emptyProviderForm = (): ProviderFormState => ({
  allowInsecurePrivateEndpoint: false,
  apiKey: '',
  baseUrl: '',
  id: '',
  textModel: 'gpt-4o-mini',
  transcriptionModel: 'gpt-4o-mini-transcribe',
});

const requiredText = (
  value: string,
  maximumLength: number,
): ProviderFormErrorCode | undefined => {
  const trimmed = value.trim();
  if (trimmed.length === 0) return 'required';
  if (trimmed.length > maximumLength) return 'tooLong';
  return undefined;
};

export const validateBaseUrlInput = (
  value: string,
  allowInsecurePrivateEndpoint: boolean,
): ProviderFormErrorCode | undefined => {
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.length > PROVIDER_LIMITS.baseUrl) return 'tooLong';

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return 'invalidUrl';
  }
  if (url.protocol === 'https:') return undefined;
  if (
    url.protocol === 'http:' &&
    allowInsecurePrivateEndpoint &&
    privateHostPattern.test(url.hostname)
  ) {
    return undefined;
  }
  return 'insecureUrl';
};

export const validateProviderForm = (
  form: ProviderFormState,
): ProviderFormErrors => {
  const errors: ProviderFormErrors = {};
  const id = form.id.trim();

  if (id.length === 0) errors.id = 'required';
  else if (!PROFILE_ID_PATTERN.test(id)) errors.id = 'invalidId';

  const textModel = requiredText(form.textModel, PROVIDER_LIMITS.model);
  if (textModel) errors.textModel = textModel;

  const transcriptionModel = requiredText(
    form.transcriptionModel,
    PROVIDER_LIMITS.model,
  );
  if (transcriptionModel) errors.transcriptionModel = transcriptionModel;

  const apiKey = requiredText(form.apiKey, PROVIDER_LIMITS.apiKey);
  if (apiKey) errors.apiKey = apiKey;

  const baseUrl = validateBaseUrlInput(
    form.baseUrl,
    form.allowInsecurePrivateEndpoint,
  );
  if (baseUrl) errors.baseUrl = baseUrl;

  return errors;
};

export const toProviderInput = (
  form: ProviderFormState,
): ClientProviderInput => {
  const baseUrl = form.baseUrl.trim();
  return {
    id: form.id.trim(),
    providerId: 'openai',
    secrets: { apiKey: form.apiKey.trim() },
    values: {
      allowInsecurePrivateEndpoint: form.allowInsecurePrivateEndpoint,
      textModel: form.textModel.trim(),
      transcriptionModel: form.transcriptionModel.trim(),
      ...(baseUrl.length > 0 ? { baseUrl } : {}),
    },
  };
};
