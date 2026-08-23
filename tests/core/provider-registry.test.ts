import { describe, expect, it } from 'vitest';
import { ProviderRegistry } from '../../src/core/providers/registry';
import { MockDictationProvider } from '../../src/core/providers/mock-provider';

describe('ProviderRegistry', () => {
  it('registers and resolves providers', () => {
    const registry = new ProviderRegistry();
    const provider = new MockDictationProvider();

    registry.register(provider);

    expect(registry.require('mock')).toBe(provider);
    expect(registry.list()).toEqual([provider]);
  });

  it('rejects duplicate provider ids', () => {
    const registry = new ProviderRegistry();
    registry.register(new MockDictationProvider());

    expect(() => registry.register(new MockDictationProvider())).toThrow(
      'already registered',
    );
  });
});
