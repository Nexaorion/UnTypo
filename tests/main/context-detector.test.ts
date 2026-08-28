import { describe, expect, it } from 'vitest';
import { ContextDetector } from '../../src/main/dictation/context-detector';

const detector = new ContextDetector();

describe('ContextDetector', () => {
  it.each([
    ['codex.exe', 'Codex'],
    ['ChatGPT.exe', 'ChatGPT/Codex'],
    ['Cursor.exe', 'Cursor'],
  ])('recognizes %s as an AI tool', (processName, name) => {
    expect(detector.detectApplicationContext({ processName })).toEqual({
      kind: 'ai-tool',
      name,
    });
  });

  it('recognizes an AI tool open in a browser from its local window title', () => {
    expect(
      detector.detectApplicationContext({
        processName: 'msedge.exe',
        windowTitle: 'Codex - OpenAI',
      }),
    ).toEqual({ kind: 'ai-tool', name: 'Codex' });
  });

  it('keeps IDE process identity ahead of incidental title words', () => {
    expect(
      detector.detectApplicationContext({
        processName: 'Code.exe',
        windowTitle: 'codex-notes.ts - Visual Studio Code',
      }),
    ).toEqual({ kind: 'ide' });
  });

  it('forces transcription only for AI tools', () => {
    expect(
      detector.shouldForceTranscription({ kind: 'ai-tool', name: 'Codex' }),
    ).toBe(true);
    expect(detector.shouldForceTranscription({ kind: 'browser' })).toBe(false);
  });
});
