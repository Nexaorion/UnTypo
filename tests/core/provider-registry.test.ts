import { describe, expect, it } from 'vitest';
import {
  ProviderRegistry,
  SpeechProviderRegistry,
  TextProviderRegistry,
} from '../../src/core/providers/registry';
import { MockDictationProvider } from '../../src/core/providers/mock-provider';

describe('ProviderRegistry', () => {
  it('registers and resolves providers', () => {
    const registry = new ProviderRegistry();
    const provider = new MockDictationProvider();

    registry.register(provider);

    expect(registry.require('mock')).toBe(provider);
    expect(registry.list()).toEqual([provider]);
  });

  it('replaces a configured provider without changing its contract id', () => {
    const registry = new ProviderRegistry();
    const first = new MockDictationProvider({ transcript: 'first' });
    const second = new MockDictationProvider({ transcript: 'second' });
    registry.register(first);

    registry.replace(second);

    expect(registry.require('mock')).toBe(second);
  });

  it('rejects duplicate provider ids', () => {
    const registry = new ProviderRegistry();
    registry.register(new MockDictationProvider());

    expect(() => registry.register(new MockDictationProvider())).toThrow(
      'already registered',
    );
  });

  it('keeps speech and text profiles in independent registries', () => {
    const provider = new MockDictationProvider();
    const speech = new SpeechProviderRegistry();
    const text = new TextProviderRegistry();

    speech.register(provider);
    text.register(provider);

    expect(speech.require('mock')).toBe(provider);
    expect(text.require('mock')).toBe(provider);
  });

  it('clears all instances for either provider role', () => {
    const speech = new SpeechProviderRegistry();
    speech.register(new MockDictationProvider());

    speech.clear();

    expect(speech.list()).toEqual([]);
    expect(speech.get('mock')).toBeUndefined();
  });
});
