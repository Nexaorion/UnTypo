export const TARGET_APPLICATION_KINDS = [
  'ai-tool',
  'browser',
  'chat-app',
  'general',
  'ide',
  'office',
] as const;

export type TargetApplicationKind = (typeof TARGET_APPLICATION_KINDS)[number];

export interface TargetApplicationContext {
  kind: TargetApplicationKind;
  name?: string;
}

export const WRITING_STYLE_PRESETS = [
  'auto',
  'casual',
  'formal',
  'concise',
  'prompt',
] as const;

export type WritingStylePreset = (typeof WRITING_STYLE_PRESETS)[number];

export type ApplicationWritingStyles = Readonly<
  Record<TargetApplicationKind, WritingStylePreset>
>;

export const DEFAULT_APPLICATION_WRITING_STYLES: ApplicationWritingStyles = {
  'ai-tool': 'prompt',
  browser: 'auto',
  'chat-app': 'casual',
  general: 'auto',
  ide: 'concise',
  office: 'formal',
};

export interface ClientApplicationWritingStyleUpdate {
  application: TargetApplicationKind;
  style: WritingStylePreset;
}
