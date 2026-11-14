import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { messages } from '../../src/renderer/i18n/messages';

const read = (path: string) => readFileSync(path, 'utf8');

describe('linux paste safeguards', () => {
  it('passes xdotool arguments without a shell', () => {
    const source = read('native/helper/src/linux/window_target.cpp');
    expect(source).not.toMatch(/\bpopen\s*\(/);
    expect(source).not.toMatch(/\bsystem\s*\(/);
    expect(source).toContain('posix_spawnp');
    expect(source).toContain('"xdotool"');
    expect(source).toContain('"--window"');
    expect(source).toContain('"--clearmodifiers"');
    expect(source).toContain('"ctrl+v"');
  });

  it('loads AT-SPI without linking it into the helper', () => {
    const cmake = read('native/helper/CMakeLists.txt');
    const probe = read('native/helper/src/linux/focus_probe.cpp');
    expect(cmake).toContain('CMAKE_DL_LIBS');
    expect(cmake).not.toContain('ATSPI2_LIBRARIES');
    expect(probe).toContain('dlopen');
    expect(probe).toContain('ATSPI_STATE_EDITABLE');
    expect(probe).toContain('ATSPI_STATE_FOCUSED');
    expect(probe).toContain('ATSPI_STATE_READ_ONLY');
  });

  it('keeps the deb runtime libraries when adding xdotool', () => {
    const builder = read('electron-builder.yml');
    expect(builder).toContain('AppImage');
    expect(builder).toContain('libgtk-3-0');
    expect(builder).toContain('libnss3');
    expect(builder).toContain('libatspi2.0-0');
    expect(builder).toContain('xdotool');
    const workflow = read('.github/workflows/client.yml');
    expect(workflow).toContain('libatspi2.0-dev');
    expect(
      workflow.match(/node node_modules\/electron\/install\.js/g)?.length,
    ).toBeGreaterThanOrEqual(3);
  });

  it('explains X11 insertion and Wayland clipboard fallback in both locales', () => {
    const zh = messages['zh-CN']['settings.linuxPasteHint'];
    const en = messages['en-US']['settings.linuxPasteHint'];
    expect(zh).toContain('xdotool');
    expect(en).toContain('xdotool');
    expect(zh).toContain('Wayland');
    expect(en).toContain('Wayland');
    expect(zh.slice(zh.indexOf('Wayland'))).not.toContain('插入');
    expect(en.slice(en.toLowerCase().indexOf('wayland'))).not.toMatch(/insert/i);
    const settings = read('src/renderer/pages/settings.tsx');
    expect(settings).toContain("platform === 'linux'");
    expect(settings).toContain("t('settings.linuxPasteHint')");
  });
});
