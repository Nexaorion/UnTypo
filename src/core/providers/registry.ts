import {
  assertSpeechProviderContract,
  assertTextProviderContract,
  ProviderContractError,
  type ProviderIdentity,
  type SpeechRecognitionProvider,
  type TextGenerationProvider,
} from './contracts.js';

type ContractAssertion<T extends ProviderIdentity> = (provider: T) => void;

class RoleProviderRegistry<T extends ProviderIdentity> {
  readonly #assertContract: ContractAssertion<T>;
  readonly #providers = new Map<string, T>();

  constructor(assertContract: ContractAssertion<T>) {
    this.#assertContract = assertContract;
  }

  clear(): void {
    this.#providers.clear();
  }

  get(providerId: string): T | undefined {
    return this.#providers.get(providerId);
  }

  list(): readonly T[] {
    return [...this.#providers.values()];
  }

  register(provider: T): void {
    this.#assertContract(provider);
    if (this.#providers.has(provider.id)) {
      throw new ProviderContractError(
        'DUPLICATE_PROVIDER',
        `Provider ${provider.id} is already registered`,
      );
    }
    this.#providers.set(provider.id, provider);
  }

  replace(provider: T): void {
    this.#assertContract(provider);
    this.#providers.set(provider.id, provider);
  }

  require(providerId: string): T {
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

export class SpeechProviderRegistry extends RoleProviderRegistry<SpeechRecognitionProvider> {
  constructor() {
    super(assertSpeechProviderContract);
  }
}

export class TextProviderRegistry extends RoleProviderRegistry<TextGenerationProvider> {
  constructor() {
    super(assertTextProviderContract);
  }
}

/** @deprecated Use SpeechProviderRegistry and TextProviderRegistry. */
export class ProviderRegistry extends SpeechProviderRegistry {}
