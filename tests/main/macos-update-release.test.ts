import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('macOS update release configuration', () => {
  it('builds a signed arm64 ZIP with GitHub update metadata', async () => {
    const config = await readFile('electron-builder.yml', 'utf8');
    const macConfig = config.slice(config.indexOf('\nmac:'), config.indexOf('\nnsis:'));

    expect(macConfig).toContain('publish:\n    provider: github');
    expect(macConfig).toContain('owner: Nexaorion');
    expect(macConfig).toContain('repo: UnTypo');
    expect(macConfig).toMatch(/- target: zip\s+arch:\s+- arm64/u);
  });

  it('publishes and verifies the macOS updater metadata and ZIP blockmap', async () => {
    const workflow = await readFile('.github/workflows/client.yml', 'utf8');
    const publishStep = workflow.slice(
      workflow.indexOf('- name: Publish macOS packages and checksums'),
      workflow.indexOf('- name: Verify published macOS release assets'),
    );
    const verifyStep = workflow.slice(
      workflow.indexOf('- name: Verify published macOS release assets'),
      workflow.indexOf('- name: Remove temporary signing assets'),
    );

    expect(publishStep).toContain('metadata="release/latest-mac.yml"');
    expect(publishStep).toContain('zip_blockmap="$zip.blockmap"');
    expect(publishStep).toContain('uploads=("$dmg" "$zip" "$metadata")');
    expect(publishStep).toContain('url: UnTypo-${RELEASE_VERSION}-mac-arm64.zip');
    expect(publishStep).toContain('path: UnTypo-${RELEASE_VERSION}-mac-arm64.zip');
    expect(verifyStep).toContain('"UnTypo-${RELEASE_VERSION}-mac-arm64.zip.blockmap"');
    expect(verifyStep).toContain('latest-mac.yml');
    expect(verifyStep).toContain('--pattern latest-mac.yml');
    expect(verifyStep).toContain('--pattern "UnTypo-${RELEASE_VERSION}-mac-arm64.zip"');
    expect(verifyStep).toContain('hashlib.sha512(zip_path.read_bytes())');
    expect(verifyStep).toContain('zip_path.stat().st_size');
    expect(verifyStep).toContain('Published latest-mac.yml does not match the published arm64 ZIP');
  });
});
