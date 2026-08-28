import type { TargetApplicationContext } from '../../core/providers/contracts.js';
import type { NativeTargetSnapshot } from '../native/protocol.js';

const aiTools: Readonly<Record<string, string>> = {
  chatgpt: 'ChatGPT/Codex',
  claude: 'Claude',
  codex: 'Codex',
  cursor: 'Cursor',
  gemini: 'Gemini',
  kiro: 'Kiro',
  windsurf: 'Windsurf',
};

const browsers = new Set(['brave', 'chrome', 'firefox', 'msedge', 'opera']);
const chatApps = new Set([
  'discord',
  'slack',
  'teams',
  'telegram',
  'wechat',
  'weixin',
]);
const ideApps = new Set([
  'code',
  'devenv',
  'idea64',
  'pycharm64',
  'rider64',
  'webstorm64',
  'zed',
]);
const officeApps = new Set([
  'excel',
  'notion',
  'obsidian',
  'olk',
  'outlook',
  'powerpnt',
  'winword',
]);
const aiTitlePatterns: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bcodex\b/iu, 'Codex'],
  [/\bchatgpt\b/iu, 'ChatGPT/Codex'],
  [/\bclaude\b/iu, 'Claude'],
  [/\bgemini\b/iu, 'Gemini'],
  [/\bperplexity\b/iu, 'Perplexity'],
];

const normalizedProcessName = (value?: string): string =>
  (value ?? '')
    .trim()
    .toLocaleLowerCase('en-US')
    .replace(/\.exe$/u, '');

const aiToolFromTitle = (title?: string): string | undefined => {
  const value = title?.trim() ?? '';
  return aiTitlePatterns.find(([pattern]) => pattern.test(value))?.[1];
};

export class ContextDetector {
  detectApplicationContext(
    target?: Pick<NativeTargetSnapshot, 'processName' | 'windowTitle'>,
  ): TargetApplicationContext {
    const processName = normalizedProcessName(target?.processName);
    const aiTool = aiTools[processName];
    if (aiTool) return { kind: 'ai-tool', name: aiTool };

    if (browsers.has(processName)) {
      const browserAiTool = aiToolFromTitle(target?.windowTitle);
      return browserAiTool
        ? { kind: 'ai-tool', name: browserAiTool }
        : { kind: 'browser' };
    }
    if (ideApps.has(processName)) return { kind: 'ide' };
    if (chatApps.has(processName)) return { kind: 'chat-app' };
    if (officeApps.has(processName)) return { kind: 'office' };

    const titledAiTool = aiToolFromTitle(target?.windowTitle);
    return titledAiTool
      ? { kind: 'ai-tool', name: titledAiTool }
      : { kind: 'general' };
  }

  shouldForceTranscription(context: TargetApplicationContext): boolean {
    return context.kind === 'ai-tool';
  }
}
