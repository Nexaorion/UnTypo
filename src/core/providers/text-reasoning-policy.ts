type RequestBody = Readonly<Record<string, unknown>>;

const normalizedModel = (model: string): string => model.trim().toLowerCase();

const endpointHostname = (baseUrl: string): string =>
  new URL(baseUrl).hostname.toLowerCase();

const isOpenRouter = (hostname: string): boolean =>
  hostname === 'openrouter.ai' || hostname.endsWith('.openrouter.ai');

const isDeepSeek = (hostname: string, model: string): boolean =>
  hostname === 'api.deepseek.com' || model.includes('deepseek');

const isBailianEndpoint = (hostname: string): boolean =>
  hostname === 'dashscope.aliyuncs.com' ||
  hostname.endsWith('.maas.aliyuncs.com');

const isClaude = (model: string): boolean => model.includes('claude');

const isOpenAIReasoningModel = (model: string): boolean =>
  /^(?:gpt-5(?:[.-]|$)|o\d(?:[.-]|$))/u.test(model);

export const chatCompletionsNoThinking = (
  baseUrl: string,
  model: string,
): RequestBody => {
  const hostname = endpointHostname(baseUrl);
  const normalized = normalizedModel(model);
  if (isOpenRouter(hostname)) return { reasoning: { effort: 'none' } };
  if (isBailianEndpoint(hostname)) return { enable_thinking: false };
  if (isDeepSeek(hostname, normalized) || isClaude(normalized)) {
    return { thinking: { type: 'disabled' } };
  }
  if (normalized.includes('qwen')) return { enable_thinking: false };
  if (isOpenAIReasoningModel(normalized)) return { reasoning_effort: 'none' };
  return {};
};

export const responsesNoThinking = (
  baseUrl: string,
  model: string,
): RequestBody => {
  const hostname = endpointHostname(baseUrl);
  const normalized = normalizedModel(model);
  if (
    isOpenRouter(hostname) ||
    isDeepSeek(hostname, normalized) ||
    isBailianEndpoint(hostname) ||
    normalized.includes('qwen') ||
    isClaude(normalized) ||
    isOpenAIReasoningModel(normalized)
  ) {
    return { reasoning: { effort: 'none' } };
  }
  return {};
};

export const anthropicNoThinking = (model: string): RequestBody =>
  /^claude-(?:opus|sonnet)-5(?:[.-]|$)/u.test(normalizedModel(model))
    ? { thinking: { type: 'disabled' } }
    : {};
