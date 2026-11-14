import { describe, expect, it } from 'vitest';

import { describeUserFacingError } from '../../../src/renderer/helpers/user-facing-error';
import type { Translate } from '../../../src/renderer/i18n/runtime';

const translate = ((key: string) => key) as Translate;

describe('describeUserFacingError connection checks', () => {
  it.each([
    ['Connection check was cancelled', 'error.connectionCheckCancelled'],
    ['Connection check returned no transcript', 'error.connectionCheckEmpty'],
    ['Connection check transcript did not match', 'error.connectionCheckMismatch'],
    [
      'OpenAI-compatible speech provider request failed with status 401: Invalid API key',
      'error.serviceAuthentication',
    ],
    ['TypeError: fetch failed', 'error.networkUnavailable'],
    ['The operation was aborted due to timeout', 'error.requestTimeout'],
  ] as const)('maps %j', (message, key) => {
    expect(describeUserFacingError(new Error(message), translate)).toBe(key);
  });
});
