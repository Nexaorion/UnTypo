import type {
  ClientProviderInput,
  ClientProviderSummary,
} from '../../shared/ipc.js';
import {
  createProviderProfileId,
  getDefaultProviderPreset,
  getProviderPreset,
  presetSupportsProviderId,
  resolveProviderPreset,
  type ProviderAdapterId,
  type ProviderKind,
  type ProviderPreset,
  type ProviderPresetId,
} from './provider-catalog.js';

export const PROFILE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/u;

export const PROVIDER_LIMITS = {
  apiKey: 16_384,
  baseUrl: 2_048,
  model: 200,
  name: 200,
} as const;

const privateHostPattern =
  /^(localhost|127(?:\.\d{1,3}){3}|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|\[?::1\]?|\[?f[cd][0-9a-f:]+\]?|[^.]+\.local)$/iu;

export interface ProviderFormState {
  allowInsecurePrivateEndpoint: boolean;
  apiKey: string;
  baseUrl: string;
  hasStoredApiKey: boolean;
  id: string;
  kind: ProviderKind;
  model: string;
  name: string;
  presetId: ProviderPresetId;
  providerId: ProviderAdapterId;
}

export type ProviderFormField =
  'apiKey' | 'baseUrl' | 'id' | 'model' | 'name' | 'presetId';

export type ProviderFormErrorCode =
  | 'insecureUrl'
  | 'invalidId'
  | 'invalidPreset'
  | 'invalidUrl'
  | 'required'
  | 'tooLong';

export type ProviderFormErrors = Partial<
  Record<ProviderFormField, ProviderFormErrorCode>
>;

const textError = (
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
  if (trimmed.length === 0) return 'required';
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

const formForPreset = (
  preset: ProviderPreset,
  existingIds: ReadonlySet<string>,
): ProviderFormState => ({
  allowInsecurePrivateEndpoint: false,
  apiKey: '',
  baseUrl: preset.baseUrl,
  hasStoredApiKey: false,
  id: createProviderProfileId(preset.id, existingIds),
  kind: preset.kind,
  model: '',
  name: preset.name,
  presetId: preset.id,
  providerId: preset.providerId,
});

export const emptyProviderForm = (
  kind: ProviderKind,
  existingIds: ReadonlySet<string> = new Set(),
): ProviderFormState =>
  formForPreset(getDefaultProviderPreset(kind), existingIds);

export const selectProviderPreset = (
  form: ProviderFormState,
  preset: ProviderPreset,
  existingIds: ReadonlySet<string>,
  preserveId: boolean,
): ProviderFormState => ({
  ...form,
  allowInsecurePrivateEndpoint: false,
  apiKey: '',
  baseUrl: preset.baseUrl,
  hasStoredApiKey: false,
  id: preserveId ? form.id : createProviderProfileId(preset.id, existingIds),
  kind: preset.kind,
  model: '',
  name: preset.name,
  presetId: preset.id,
  providerId: preset.providerId,
});

export const selectTextEndpointType = (
  form: ProviderFormState,
  providerId:
    'anthropic-text' | 'openai-compatible-text' | 'openai-responses-text',
): ProviderFormState => {
  if (form.providerId === providerId) return form;
  return {
    ...form,
    apiKey: '',
    hasStoredApiKey: false,
    providerId,
  };
};

const asString = (value: unknown): string =>
  typeof value === 'string' ? value : '';

export const providerFormFromSummary = (
  summary: ClientProviderSummary,
): ProviderFormState => {
  const baseUrl = asString(summary.values.baseUrl);
  const preset = resolveProviderPreset({
    baseUrl,
    kind: summary.kind,
    presetId: asString(summary.values.presetId),
    providerId: summary.providerId,
  });

  return {
    allowInsecurePrivateEndpoint:
      summary.values.allowInsecurePrivateEndpoint === true,
    apiKey: '',
    baseUrl,
    hasStoredApiKey: summary.configuredSecretKeys.includes('apiKey'),
    id: summary.id,
    kind: summary.kind,
    model: asString(summary.values.model),
    name: asString(summary.values.name),
    presetId: preset.id,
    providerId: summary.providerId,
  };
};

export const validateProviderForm = (
  form: ProviderFormState,
): ProviderFormErrors => {
  const errors: ProviderFormErrors = {};
  const id = form.id.trim();

  if (id.length === 0) errors.id = 'required';
  else if (!PROFILE_ID_PATTERN.test(id)) errors.id = 'invalidId';

  const preset = getProviderPreset(form.presetId);
  if (
    !preset ||
    preset.kind !== form.kind ||
    !presetSupportsProviderId(preset, form.providerId)
  ) {
    errors.presetId = 'invalidPreset';
  }

  const name = textError(form.name, PROVIDER_LIMITS.name);
  if (name) errors.name = name;

  const model = textError(form.model, PROVIDER_LIMITS.model);
  if (model) errors.model = model;

  const apiKey = form.apiKey.trim();
  if (apiKey.length === 0 && !form.hasStoredApiKey) errors.apiKey = 'required';
  else if (apiKey.length > PROVIDER_LIMITS.apiKey) errors.apiKey = 'tooLong';

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
  const apiKey = form.apiKey.trim();
  return {
    id: form.id.trim(),
    kind: form.kind,
    providerId: form.providerId,
    secrets: apiKey ? { apiKey } : {},
    values: {
      allowInsecurePrivateEndpoint: form.allowInsecurePrivateEndpoint,
      baseUrl: form.baseUrl.trim(),
      model: form.model.trim(),
      name: form.name.trim(),
      presetId: form.presetId,
    },
  };
};
