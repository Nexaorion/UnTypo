import type { WebContents } from 'electron';

// Locale-independent: selects by ARIA roles and stable test IDs instead of copy.
const smokeTestSource = `
  (async () => {
    const wait = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds));
    const snapshot = await window.untypo?.getSnapshot();
    if (!snapshot || !Array.isArray(snapshot.dictionary)) return 'snapshot';
    const usage = await window.untypo?.getUsageStats();
    if (!usage || typeof usage.usageCount !== 'number') return 'usage';
    const diagnostics = await window.untypo?.getDiagnostics();
    if (!diagnostics || diagnostics.privacy.secretsCollected !== false)
      return 'diagnostics';

    const startupDiagnostics = document.querySelector(
      '[data-testid="diagnostics-dialog"]',
    );
    if (startupDiagnostics) {
      const later = startupDiagnostics.querySelector(
        '[data-testid="diagnostics-later"]',
      );
      if (!later) return 'startup-diagnostics-close';
      later.click();
      await wait(300);
      if (document.querySelector('[data-testid="diagnostics-dialog"]'))
        return 'startup-diagnostics-stale';
    }

    const bodyBackground = getComputedStyle(document.body).backgroundColor;
    const expectedBackground = matchMedia('(prefers-color-scheme: dark)').matches
      ? 'rgb(17, 17, 17)'
      : 'rgb(255, 255, 255)';
    if (bodyBackground !== expectedBackground)
      return 'palette:' + bodyBackground + ':' + expectedBackground;

    const main = document.querySelector('main');
    if (!main?.querySelector('h1')) return 'home-heading';

    const settingsTrigger = document.querySelector('[data-testid="settings-open"]');
    if (!settingsTrigger) return 'settings-trigger';
    settingsTrigger.click();
    await wait(300);

    let settingsRoot = document.querySelector('[data-testid="settings-dialog"]');
    if (!settingsRoot) return 'settings-dialog';
    let settingsDialog = settingsRoot.matches('[role="dialog"]')
      ? settingsRoot
      : settingsRoot.querySelector('[role="dialog"]');
    if (!settingsDialog) return 'settings-dialog-role';
    const settingsLabelledBy = settingsDialog.getAttribute('aria-labelledby');
    if (!settingsLabelledBy || !document.getElementById(settingsLabelledBy))
      return 'settings-dialog-label';
    if (settingsRoot.querySelector('main')) return 'settings-nested-main';
    const settingsTab = settingsRoot.querySelector('#settings-tab-settings');
    if (settingsTab?.getAttribute('aria-selected') !== 'true')
      return 'settings-tab';
    const settingsPanel = settingsRoot.querySelector('#settings-panel-settings');
    if (!settingsPanel?.querySelector('input')) return 'settings-controls';
    if (!settingsPanel.querySelector('[role="combobox"]'))
      return 'settings-combobox';
    if (!settingsPanel.querySelector('[data-testid="microphone-select"]'))
      return 'microphone-select';
    if (!settingsPanel.querySelector('[data-testid="microphone-refresh"]'))
      return 'microphone-refresh';
    if (!settingsPanel.querySelector('[data-testid="diagnostics-open"]'))
      return 'diagnostics-open';
    const hotkeyCapture = settingsPanel.querySelector(
      '[data-testid="hotkey-capture"]',
    );
    if (!hotkeyCapture) return 'hotkey-capture';
    if (hotkeyCapture.querySelectorAll('kbd').length < 1)
      return 'hotkey-keycaps';

    const settingsClose = settingsRoot.querySelector('[data-testid="settings-close"]');
    if (!settingsClose) return 'settings-close';
    settingsClose.click();
    await wait(600);
    if (document.querySelector('[data-testid="settings-dialog"]'))
      return 'settings-dialog-close';

    const modelsTrigger = document.querySelector('[data-testid="models-open"]');
    if (!modelsTrigger) return 'models-trigger';
    modelsTrigger.click();
    await wait(300);

    settingsRoot = document.querySelector('[data-testid="settings-dialog"]');
    if (!settingsRoot) return 'models-dialog';
    const modelsTab = settingsRoot.querySelector('#settings-tab-models');
    if (modelsTab?.getAttribute('aria-selected') !== 'true') return 'models-tab';
    if (!settingsRoot.querySelector('[data-testid="provider-section-text"]'))
      return 'provider-text-section';
    if (!settingsRoot.querySelector('[data-testid="provider-section-speech"]'))
      return 'provider-speech-section';

    const addText = settingsRoot.querySelector('[data-testid="provider-add-text"]');
    if (!addText) return 'provider-trigger';
    addText.click();
    await wait(300);

    const activeDiagnostics = document.querySelector(
      '[data-testid="diagnostics-dialog"]',
    );
    if (activeDiagnostics) {
      const later = activeDiagnostics.querySelector(
        '[data-testid="diagnostics-later"]',
      );
      if (!later) return 'active-diagnostics-close';
      later.click();
      await wait(300);
    }

    let dialogs = [...document.querySelectorAll('[role="dialog"]')];
    if (dialogs.length !== 2) return 'nested-dialog-count:' + dialogs.length;
    const providerDialog = dialogs[dialogs.length - 1];
    const providerLabelledBy = providerDialog.getAttribute('aria-labelledby');
    if (!providerLabelledBy || !document.getElementById(providerLabelledBy))
      return 'provider-dialog-label';
    const picker = providerDialog.querySelector('[data-testid="provider-picker"]');
    if (!picker) return 'provider-picker';
    if (providerDialog.querySelector('[data-testid="provider-details"]'))
      return 'provider-details-early';
    const customPreset = providerDialog.querySelector(
      '[data-testid="provider-preset-custom-text"]',
    );
    if (!customPreset) return 'provider-custom-preset';
    customPreset.click();
    await wait(200);
    if (providerDialog.querySelector('[data-testid="provider-picker"]'))
      return 'provider-picker-stale';
    const details = providerDialog.querySelector('[data-testid="provider-details"]');
    if (!details) return 'provider-details';
    if (!details.querySelector('[role="combobox"]'))
      return 'provider-endpoint-type';

    const control = providerDialog.querySelector('[role="switch"]');
    if (!control) return 'switch-missing';
    if (control.checked !== false) return 'switch-state';
    control.click();
    await wait(80);
    if (control.checked !== true) return 'switch-toggle';

    const unlabelled = [...providerDialog.querySelectorAll('input')].filter(
      (input) =>
        input.getAttribute('aria-hidden') !== 'true' &&
        input.getAttribute('type') !== 'hidden' &&
        !(input.labels && input.labels.length > 0) &&
        !input.getAttribute('aria-labelledby') &&
        !input.getAttribute('aria-label'),
    );
    if (unlabelled.length > 0) return 'input-label:' + unlabelled.length;

    providerDialog.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }),
    );
    await wait(600);
    dialogs = [...document.querySelectorAll('[role="dialog"]')];
    if (dialogs.length !== 1) return 'provider-dialog-close:' + dialogs.length;

    settingsRoot = document.querySelector('[data-testid="settings-dialog"]');
    const modelsClose = settingsRoot?.querySelector('[data-testid="settings-close"]');
    if (!modelsClose) return 'models-close';
    modelsClose.click();
    await wait(600);
    if (document.querySelectorAll('[role="dialog"]').length !== 0)
      return 'models-dialog-close';

    const dictionaryTrigger = document.querySelector(
      '[data-testid="dictionary-open"]',
    );
    if (!dictionaryTrigger) return 'dictionary-trigger';
    dictionaryTrigger.click();
    await wait(120);
    if (!main.querySelector('form')) return 'dictionary-form';
    return 'ok';
  })()
`;

const responsiveSmokeTestSource = `
  (async () => {
    const wait = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds));
    const viewportWidth = document.documentElement.clientWidth;
    if (viewportWidth !== 375) return 'viewport:' + viewportWidth;

    const modelsTrigger = document.querySelector('[data-testid="models-open"]');
    if (!modelsTrigger) return 'models-trigger';
    modelsTrigger.click();
    await wait(300);

    const settingsRoot = document.querySelector('[data-testid="settings-dialog"]');
    if (!settingsRoot) return 'settings-dialog';
    const settingsDialog = settingsRoot.matches('[role="dialog"]')
      ? settingsRoot
      : settingsRoot.querySelector('[role="dialog"]');
    if (!settingsDialog) return 'settings-dialog-role';
    const settingsRect = settingsDialog.getBoundingClientRect();
    if (settingsRect.left < -1 || settingsRect.right > viewportWidth + 1)
      return 'settings-bounds:' + settingsRect.left + ':' + settingsRect.right;
    if (settingsDialog.scrollWidth > settingsDialog.clientWidth + 1)
      return 'settings-horizontal-scroll';

    const navigation = settingsRoot.querySelector('nav');
    if (!navigation) return 'settings-navigation';
    const navigationWidth = navigation.getBoundingClientRect().width;
    if (navigationWidth > 80)
      return 'settings-navigation-width:' + navigationWidth;

    const modelsPanel = settingsRoot.querySelector('#settings-panel-models');
    if (!modelsPanel) return 'models-panel';
    if (modelsPanel.scrollWidth > modelsPanel.clientWidth + 1)
      return 'models-horizontal-scroll';

    const addText = modelsPanel.querySelector('[data-testid="provider-add-text"]');
    if (!addText) return 'provider-trigger';
    addText.click();
    await wait(300);

    const dialogs = [...document.querySelectorAll('[role="dialog"]')];
    if (dialogs.length !== 2) return 'nested-dialog-count:' + dialogs.length;
    const providerDialog = dialogs[dialogs.length - 1];
    const providerRect = providerDialog.getBoundingClientRect();
    if (providerRect.left < -1 || providerRect.right > viewportWidth + 1)
      return 'provider-bounds:' + providerRect.left + ':' + providerRect.right;
    if (providerDialog.scrollWidth > providerDialog.clientWidth + 1)
      return 'provider-horizontal-scroll';

    const presets = [
      ...providerDialog.querySelectorAll('[data-testid^="provider-preset-"]'),
    ];
    if (presets.length < 2) return 'provider-presets';
    if (
      presets.some((preset) => {
        const rect = preset.getBoundingClientRect();
        return rect.left < -1 || rect.right > viewportWidth + 1;
      })
    ) {
      return 'provider-preset-bounds';
    }

    const customPreset = providerDialog.querySelector(
      '[data-testid="provider-preset-custom-text"]',
    );
    if (!customPreset) return 'provider-custom-preset';
    customPreset.click();
    await wait(200);
    const details = providerDialog.querySelector('[data-testid="provider-details"]');
    if (!details) return 'provider-details';
    if (details.scrollWidth > details.clientWidth + 1)
      return 'provider-details-horizontal-scroll';
    if (!details.querySelector('[role="combobox"]'))
      return 'provider-endpoint-type';

    providerDialog.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }),
    );
    await wait(600);
    const close = settingsRoot.querySelector('[data-testid="settings-close"]');
    if (!close) return 'settings-close';
    close.click();
    await wait(600);
    return 'ok';
  })()
`;

const runResponsiveSmokeTest = async (
  webContents: WebContents,
): Promise<string> => {
  const attachedHere = !webContents.debugger.isAttached();
  if (attachedHere) webContents.debugger.attach('1.3');
  try {
    await webContents.debugger.sendCommand(
      'Emulation.setDeviceMetricsOverride',
      {
        deviceScaleFactor: 1,
        height: 812,
        mobile: true,
        screenHeight: 812,
        screenWidth: 375,
        width: 375,
      },
    );
    return (await webContents.executeJavaScript(
      responsiveSmokeTestSource,
    )) as string;
  } finally {
    await webContents.debugger.sendCommand(
      'Emulation.clearDeviceMetricsOverride',
    );
    if (attachedHere) webContents.debugger.detach();
  }
};

export const runRendererSmokeTest = async (
  webContents: WebContents,
): Promise<string> => {
  const desktopResult = (await webContents.executeJavaScript(
    smokeTestSource,
  )) as string;
  if (desktopResult !== 'ok') return desktopResult;
  const responsiveResult = await runResponsiveSmokeTest(webContents);
  return responsiveResult === 'ok' ? 'ok' : `responsive-${responsiveResult}`;
};
