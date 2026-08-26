import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  PROVIDER_CONTRACT_VERSION,
  assertProviderContract,
  type AudioPayload,
  type DictationIntent,
  type ProcessOptions,
} from '../../src/core/providers/contracts';
import {
  MockDictationProvider,
  type MockProviderScenario,
} from '../../src/core/providers/mock-provider';
import { DictationPipeline } from '../../src/core/providers/pipeline';

interface ContractFixture extends MockProviderScenario {
  expectedText: string;
  intent: DictationIntent;
  name: string;
}

const audio: AudioPayload = {
  bytes: new Uint8Array([1, 2, 3]),
  channels: 1,
  durationMs: 900,
  mimeType: 'audio/webm;codecs=opus',
  sampleRateHz: 48_000,
};

const options: ProcessOptions = {
  defaultTargetLanguage: 'en-US',
  dictionary: [],
  language: 'zh-CN',
};

const loadFixtures = async (): Promise<ContractFixture[]> => {
  const source = await readFile(
    'tests/fixtures/provider/v1/contract-cases.json',
    'utf8',
  );
  return JSON.parse(source) as ContractFixture[];
};

describe('provider contract v3', () => {
  it('publishes a stable version identifier', () => {
    expect(PROVIDER_CONTRACT_VERSION).toBe('3.0');
  });

  it('accepts the bundled mock provider', () => {
    expect(() =>
      assertProviderContract(new MockDictationProvider()),
    ).not.toThrow();
  });

  it('runs all provider fixtures through the default pipeline', async () => {
    const fixtures = await loadFixtures();

    for (const fixture of fixtures) {
      const provider = new MockDictationProvider(fixture);
      const result = await new DictationPipeline(provider, provider).process(
        audio,
        options,
      );

      expect(result, fixture.name).toMatchObject({
        intent: fixture.intent,
        outputText: fixture.expectedText,
        rawTranscript: fixture.transcript,
      });
    }
  });

  it('supports the equivalent integrated process path', async () => {
    const provider = new MockDictationProvider({
      intent: 'translation',
      transcript: '你好',
      translatedText: { 'en-US': 'Hello' },
    });

    const result = await new DictationPipeline(provider, provider).process(
      audio,
      {
        ...options,
        preferIntegratedProcess: true,
      },
    );

    expect(result).toMatchObject({
      intent: 'translation',
      outputText: 'Hello',
      rawTranscript: '你好',
    });
  });
});
