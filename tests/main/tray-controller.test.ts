import { beforeEach, describe, expect, it, vi } from 'vitest';

const trayMocks = vi.hoisted(() => {
  class MockTray {
    on = vi.fn();
    setToolTip = vi.fn();
    setContextMenu = vi.fn();
    destroy = vi.fn();
  }
  return { MockTray, instances: [] as MockTray[] };
});

const electronMocks = vi.hoisted(() => {
  const menuTemplate = {
    buildFromTemplate: vi.fn((template: unknown[]) => template),
  };
  return {
    Menu: menuTemplate,
    app: { isPackaged: false, quit: vi.fn() },
    nativeImage: {
      createFromPath: vi.fn(() => ({
        isEmpty: () => false,
        resize: vi.fn(function (this: { resize: unknown }) {
          return this;
        }),
        setTemplateImage: vi.fn(),
      })),
    },
  };
});

vi.mock('electron', () => ({
  Menu: electronMocks.Menu,
  Tray: class extends trayMocks.MockTray {
    constructor() {
      super();
      trayMocks.instances.push(this);
    }
  },
  app: electronMocks.app,
  nativeImage: electronMocks.nativeImage,
}));

import { TrayController } from '../../src/main/tray/tray-controller.js';

const createController = (getRecordingState = () => false) => {
  const onShowSettings = vi.fn();
  const onToggleDictation = vi.fn();
  const controller = new TrayController({
    applicationIconPath: 'C:\\app\\icon.ico',
    getRecordingState,
    onShowSettings,
    onToggleDictation,
  });
  return { controller, onShowSettings, onToggleDictation };
};

const menuTemplate = (): ReadonlyArray<{
  click?: () => void;
  label?: string;
  type?: string;
}> =>
  electronMocks.Menu.buildFromTemplate.mock.calls.at(-1)?.[0] as ReadonlyArray<{
    click?: () => void;
    label?: string;
    type?: string;
  }>;

describe('TrayController', () => {
  beforeEach(() => {
    trayMocks.instances.length = 0;
    electronMocks.Menu.buildFromTemplate.mockClear();
    electronMocks.app.quit.mockClear();
  });

  it('creates a localized tray menu and tooltip', () => {
    const { controller } = createController();

    controller.create('en-US');

    expect(trayMocks.instances).toHaveLength(1);
    const tray = trayMocks.instances[0];
    expect(tray.setToolTip).toHaveBeenCalledWith('UnTypo Dictation');
    expect(menuTemplate()?.map((item) => item.label)).toEqual([
      'Start dictation',
      'Open settings',
      undefined,
      'Quit',
    ]);
  });

  it('reflects the recording state and locale in the menu', () => {
    const { controller } = createController(() => true);

    controller.create('en-US');
    controller.applyLocale('zh-CN');

    const tray = trayMocks.instances[0];
    expect(tray.setToolTip).toHaveBeenCalledWith('UnTypo 听写');
    expect(menuTemplate()?.map((item) => item.label)).toEqual([
      '停止听写',
      '打开设置',
      undefined,
      '退出',
    ]);
  });

  it('routes menu clicks through the runtime callbacks', () => {
    const { controller, onShowSettings, onToggleDictation } =
      createController();

    controller.create('en-US');
    const template = menuTemplate() ?? [];
    template[0]?.click?.();
    template[1]?.click?.();
    template[3]?.click?.();

    expect(onToggleDictation).toHaveBeenCalledOnce();
    expect(onShowSettings).toHaveBeenCalledOnce();
    expect(electronMocks.app.quit).toHaveBeenCalledOnce();
  });

  it('destroys the tray window on demand', () => {
    const { controller } = createController();

    controller.create('en-US');
    controller.destroy();

    expect(trayMocks.instances[0].destroy).toHaveBeenCalledOnce();
  });
});
