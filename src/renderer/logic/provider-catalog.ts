import type { ModelProviderId, ModelProviderKind } from '../../shared/ipc.js';
import type { MessageKey } from '../i18n/messages.js';

export type ProviderKind = ModelProviderKind;

export type ProviderAdapterId = ModelProviderId;

export type ProviderIconId =
  | 'alibaba-cloud'
  | 'anthropic'
  | 'custom'
  | 'deepseek'
  | 'groq'
  | 'openai'
  | 'openrouter';

export type ProviderPresetId =
  | 'aliyun-bailian-speech'
  | 'anthropic-text'
  | 'custom-openai-speech'
  | 'custom-text'
  | 'deepseek-text'
  | 'groq-speech'
  | 'openai-speech'
  | 'openai-text'
  | 'openrouter-text';

export interface ProviderPreset {
  baseUrl: string;
  icon: ProviderIconId;
  id: ProviderPresetId;
  kind: ProviderKind;
  labelKey: MessageKey;
  name: string;
  providerId: ProviderAdapterId;
  supportedProviderIds?: readonly ProviderAdapterId[];
}

export interface TextEndpointTypeOption {
  labelKey: MessageKey;
  providerId:
    'anthropic-text' | 'openai-compatible-text' | 'openai-responses-text';
}

export const TEXT_ENDPOINT_TYPES = [
  {
    labelKey: 'provider.endpointType.openaiResponses',
    providerId: 'openai-responses-text',
  },
  {
    labelKey: 'provider.endpointType.openaiChatCompletions',
    providerId: 'openai-compatible-text',
  },
  {
    labelKey: 'provider.endpointType.anthropicMessages',
    providerId: 'anthropic-text',
  },
] as const satisfies readonly TextEndpointTypeOption[];

export const PROVIDER_PRESETS = [
  {
    baseUrl: 'https://api.openai.com/v1',
    icon: 'openai',
    id: 'openai-text',
    kind: 'text',
    labelKey: 'provider.preset.openai',
    name: 'OpenAI',
    providerId: 'openai-responses-text',
    supportedProviderIds: ['openai-responses-text', 'openai-compatible-text'],
  },
  {
    baseUrl: 'https://api.anthropic.com/v1',
    icon: 'anthropic',
    id: 'anthropic-text',
    kind: 'text',
    labelKey: 'provider.preset.anthropic',
    name: 'Anthropic',
    providerId: 'anthropic-text',
  },
  {
    baseUrl: 'https://api.deepseek.com',
    icon: 'deepseek',
    id: 'deepseek-text',
    kind: 'text',
    labelKey: 'provider.preset.deepseek',
    name: 'DeepSeek',
    providerId: 'openai-compatible-text',
  },
  {
    baseUrl: 'https://openrouter.ai/api/v1',
    icon: 'openrouter',
    id: 'openrouter-text',
    kind: 'text',
    labelKey: 'provider.preset.openrouter',
    name: 'OpenRouter',
    providerId: 'openai-compatible-text',
  },
  {
    baseUrl: '',
    icon: 'custom',
    id: 'custom-text',
    kind: 'text',
    labelKey: 'provider.preset.custom',
    name: 'Custom provider',
    providerId: 'openai-responses-text',
    supportedProviderIds: TEXT_ENDPOINT_TYPES.map(
      ({ providerId }) => providerId,
    ),
  },
  {
    baseUrl: 'https://api.openai.com/v1',
    icon: 'openai',
    id: 'openai-speech',
    kind: 'speech',
    labelKey: 'provider.preset.openai',
    name: 'OpenAI',
    providerId: 'openai-compatible-speech',
  },
  {
    baseUrl: 'https://api.groq.com/openai/v1',
    icon: 'groq',
    id: 'groq-speech',
    kind: 'speech',
    labelKey: 'provider.preset.groq',
    name: 'Groq',
    providerId: 'openai-compatible-speech',
  },
  {
    baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
    icon: 'alibaba-cloud',
    id: 'aliyun-bailian-speech',
    kind: 'speech',
    labelKey: 'provider.preset.aliyunBailian',
    name: 'Alibaba Cloud Model Studio',
    providerId: 'aliyun-bailian-speech',
  },
  {
    baseUrl: '',
    icon: 'custom',
    id: 'custom-openai-speech',
    kind: 'speech',
    labelKey: 'provider.preset.custom',
    name: 'Custom provider',
    providerId: 'openai-compatible-speech',
  },
] as const satisfies readonly ProviderPreset[];

export const getProviderPreset = (
  presetId: string,
): ProviderPreset | undefined =>
  PROVIDER_PRESETS.find((preset) => preset.id === presetId);

export const presetSupportsProviderId = (
  preset: ProviderPreset,
  providerId: string,
): providerId is ProviderAdapterId =>
  (preset.supportedProviderIds ?? [preset.providerId]).some(
    (candidate) => candidate === providerId,
  );

export const getProviderPresets = (
  kind: ProviderKind,
): readonly ProviderPreset[] =>
  PROVIDER_PRESETS.filter((preset) => preset.kind === kind);

export const getDefaultProviderPreset = (
  kind: ProviderKind,
): ProviderPreset => {
  const preset = getProviderPresets(kind)[0];
  if (!preset) throw new Error(`No provider presets for ${kind}`);
  return preset;
};

export const resolveProviderPreset = ({
  baseUrl,
  kind,
  presetId,
  providerId,
}: {
  baseUrl: string;
  kind: ProviderKind;
  presetId: string;
  providerId: string;
}): ProviderPreset => {
  const explicit = getProviderPreset(presetId);
  if (
    explicit?.kind === kind &&
    presetSupportsProviderId(explicit, providerId)
  ) {
    return explicit;
  }

  const exactEndpoint = getProviderPresets(kind).find(
    (preset) =>
      presetSupportsProviderId(preset, providerId) &&
      preset.baseUrl === baseUrl.trim(),
  );
  if (exactEndpoint) return exactEndpoint;

  const fallbackId: ProviderPresetId =
    kind === 'speech'
      ? providerId === 'aliyun-bailian-speech'
        ? 'aliyun-bailian-speech'
        : 'custom-openai-speech'
      : 'custom-text';

  return getProviderPreset(fallbackId) ?? getDefaultProviderPreset(kind);
};

export const createProviderProfileId = (
  presetId: ProviderPresetId,
  existingIds: ReadonlySet<string>,
): string => {
  const base = presetId.slice(0, 64);
  if (!existingIds.has(base)) return base;

  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const ending = `-${suffix}`;
    const candidate = `${base.slice(0, 64 - ending.length)}${ending}`;
    if (!existingIds.has(candidate)) return candidate;
  }

  throw new Error('Unable to allocate provider profile ID');
};
