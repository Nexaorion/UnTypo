import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveRendererRoot } from '../../../src/main/platform/app-protocol';

describe('resolveRendererRoot', () => {
  it('points at dist/renderer from the compiled platform module directory', () => {
    expect(resolveRendererRoot(path.join('dist', 'main', 'platform'))).toBe(
      path.resolve('dist', 'renderer'),
    );
  });
});
