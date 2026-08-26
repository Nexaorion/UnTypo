import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { isTrustedRendererUrl } from '../../src/main/security';

const originalDevServerUrl = process.env.VITE_DEV_SERVER_URL;

afterEach(() => {
  if (originalDevServerUrl === undefined) {
    delete process.env.VITE_DEV_SERVER_URL;
  } else {
    process.env.VITE_DEV_SERVER_URL = originalDevServerUrl;
  }
});

describe('isTrustedRendererUrl', () => {
  it('accepts only the packaged renderer host in production', () => {
    delete process.env.VITE_DEV_SERVER_URL;

    expect(isTrustedRendererUrl('app://renderer/index.html')).toBe(true);
    expect(isTrustedRendererUrl('app://untrusted/index.html')).toBe(false);
    expect(isTrustedRendererUrl('https://renderer.example')).toBe(false);
  });

  it('accepts only the fixed development origin', () => {
    process.env.VITE_DEV_SERVER_URL = 'http://127.0.0.1:3000';

    expect(isTrustedRendererUrl('http://127.0.0.1:3000/index.html')).toBe(true);
    expect(isTrustedRendererUrl('http://localhost:3000/index.html')).toBe(
      false,
    );
    expect(isTrustedRendererUrl('http://127.0.0.1:3001/index.html')).toBe(
      false,
    );
  });

  it('rejects malformed values', () => {
    expect(isTrustedRendererUrl('not a url')).toBe(false);
  });
});

describe('capsule Content-Security-Policy', () => {
  it('allows Vite and Emotion to inject the capsule runtime styles', () => {
    const capsuleHtml = readFileSync(
      new URL('../../capsule.html', import.meta.url),
      'utf8',
    );

    expect(capsuleHtml).toContain("script-src 'self';");
    expect(capsuleHtml).toContain("style-src 'self' 'unsafe-inline';");
    expect(capsuleHtml).not.toContain("script-src 'self' 'unsafe-inline';");
  });
});
