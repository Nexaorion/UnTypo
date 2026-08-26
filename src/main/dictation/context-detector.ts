import type { WindowContext } from '../../core/providers/contracts.js';

export type ApplicationContext = 'ai-tool' | 'chat-app' | 'browser' | 'office' | 'ide' | 'general';

export class ContextDetector {
  detectApplicationContext(windowContext?: WindowContext): ApplicationContext {
    if (!windowContext) return 'general';
    return 'general';
  }

  shouldPreferTranscription(context: ApplicationContext): boolean {
    if (context === 'ai-tool') return true;
    if (context === 'chat-app') return true;
    return false;
  }
}
