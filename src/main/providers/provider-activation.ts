import type { TextGenerationProvider } from '../../core/providers/contracts.js';
import {
  SpeechProviderRegistry,
  TextProviderRegistry,
} from '../../core/providers/registry.js';
import type { DiagnosticCollector } from '../diagnostics/collector.js';
import type {
  ConfigurationService,
  ProviderProfile,
  StoredClientConfig,
} from '../storage/configuration.js';
import {
  createSpeechProvider,
  createTextProvider,
} from './provider-factory.js';

export interface ProviderActivationOptions {
  configuration: ConfigurationService;
  diagnostics: DiagnosticCollector;
}

export class ProviderActivationService {
  readonly #configuration: ConfigurationService;
  readonly #diagnostics: DiagnosticCollector;
  readonly #speechProviders = new SpeechProviderRegistry();
  readonly #textProviders = new TextProviderRegistry();
  #speechProviderId?: string;
  #textProviderId?: string;

  constructor(options: ProviderActivationOptions) {
    this.#configuration = options.configuration;
    this.#diagnostics = options.diagnostics;
  }

  get speechProviders(): SpeechProviderRegistry {
    return this.#speechProviders;
  }

  get textProviders(): TextProviderRegistry {
    return this.#textProviders;
  }

  get speechProviderId(): string | undefined {
    return this.#speechProviderId;
  }

  get textProviderId(): string | undefined {
    return this.#textProviderId;
  }

  get activeTextProvider(): TextGenerationProvider | undefined {
    return this.#textProviderId
      ? this.#textProviders.get(this.#textProviderId)
      : undefined;
  }

  async activate(config: StoredClientConfig): Promise<void> {
    this.#speechProviders.clear();
    this.#textProviders.clear();
    this.#speechProviderId = undefined;
    this.#textProviderId = undefined;

    const speechProfileId = config.dictation.activeSpeechProviderProfileId;
    if (speechProfileId) {
      const profile = await this.#configuration.getProvider(speechProfileId);
      if (!profile) {
        throw new Error('Active speech provider profile does not exist');
      }
      const provider = createSpeechProvider(
        profile,
        this.providerFetch(profile),
      );
      this.#speechProviders.replace(provider);
      this.#speechProviderId = provider.id;
    }

    const textProfileId = config.dictation.activeTextProviderProfileId;
    if (textProfileId) {
      const profile = await this.#configuration.getProvider(textProfileId);
      if (!profile) {
        throw new Error('Active text provider profile does not exist');
      }
      const provider = createTextProvider(profile, this.providerFetch(profile));
      this.#textProviders.replace(provider);
      this.#textProviderId = provider.id;
    }
  }

  providerFetch(profile: ProviderProfile): typeof fetch {
    return this.#diagnostics.createLoggedFetch({
      model: profile.values.model,
      profileId: profile.id,
      providerId: profile.providerId,
    });
  }
}
