import {
  assertProviderContract,
  ProviderContractError,
  type DictationProvider,
} from './contracts.js';

export class ProviderRegistry {
  readonly #providers = new Map<string, DictationProvider>();

  register(provider: DictationProvider): void {
    assertProviderContract(provider);
    if (this.#providers.has(provider.id)) {
      throw new ProviderContractError(
        'DUPLICATE_PROVIDER',
        `Provider ${provider.id} is already registered`,
      );
    }
    this.#providers.set(provider.id, provider);
  }

  replace(provider: DictationProvider): void {
    assertProviderContract(provider);
    this.#providers.set(provider.id, provider);
  }

  get(providerId: string): DictationProvider | undefined {
    return this.#providers.get(providerId);
  }

  list(): readonly DictationProvider[] {
    return [...this.#providers.values()];
  }

  require(providerId: string): DictationProvider {
    const provider = this.get(providerId);
    if (!provider) {
      throw new ProviderContractError(
        'INVALID_OPTIONS',
        `Provider ${providerId} is not registered`,
      );
    }
    return provider;
  }
}
