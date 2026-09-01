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
    const hotkeyCapture = settingsPanel.querySelector(
      '[data-testid="hotkey-capture"]',
    );
    if (!hotkeyCapture) return 'hotkey-capture';
    if (hotkeyCapture.querySelectorAll('kbd').length < 1)
      return 'hotkey-keycaps';

    const fastMode = settingsPanel.querySelector('[role="switch"]');
    if (!(fastMode instanceof HTMLInputElement)) return 'fast-mode-switch';
    const fastModeWasEnabled = fastMode.checked;
    fastMode.click();
    await wait(120);
    if (fastMode.checked === fastModeWasEnabled) return 'fast-mode-toggle';
    fastMode.click();
    await wait(120);
    if (fastMode.checked !== fastModeWasEnabled) return 'fast-mode-restore';

    const personalizationTab = settingsRoot.querySelector(
      '#settings-tab-personalization',
    );
    if (!personalizationTab) return 'personalization-tab';
    personalizationTab.click();
    await wait(120);
    if (personalizationTab.getAttribute('aria-selected') !== 'true')
      return 'personalization-tab-state';
    const personalizationPanel = settingsRoot.querySelector(
      '#settings-panel-personalization',
    );
    if (!personalizationPanel) return 'personalization-panel';
    if (personalizationPanel.querySelector('form'))
      return 'personalization-dictionary-form';
    const chatStyleRoot = personalizationPanel.querySelector(
      '[data-testid="writing-style-chat-app"]',
    );
    const originalChatStyle =
      snapshot.personalization?.applicationStyles?.['chat-app'];
    if (
      !chatStyleRoot?.querySelector('[role="combobox"]') ||
      typeof originalChatStyle !== 'string'
    )
      return 'writing-style-chat-app';
    const alternateChatStyle =
      originalChatStyle === 'formal' ? 'casual' : 'formal';
    const pickWritingStyle = async (style) => {
      const combobox = personalizationPanel.querySelector(
        '[data-testid="writing-style-chat-app"] [role="combobox"]',
      );
      if (!combobox) return false;
      combobox.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          button: 0,
          cancelable: true,
          view: window,
        }),
      );
      await wait(80);
      const option = Array.from(document.querySelectorAll('[role="option"]')).find(
        (candidate) => candidate.getAttribute('data-value') === style,
      );
      if (!option) return false;
      option.click();
      await wait(160);
      return true;
    };
    if (!(await pickWritingStyle(alternateChatStyle)))
      return 'writing-style-option';
    const changedPersonalization = await window.untypo?.getSnapshot();
    if (
      changedPersonalization?.personalization?.applicationStyles?.['chat-app'] !==
      alternateChatStyle
    ) {
      return 'writing-style-update';
    }
    if (!(await pickWritingStyle(originalChatStyle)))
      return 'writing-style-restore-option';
    const restoredPersonalization = await window.untypo?.getSnapshot();
    if (
      restoredPersonalization?.personalization?.applicationStyles?.['chat-app'] !==
      originalChatStyle
    ) {
      return 'writing-style-restore';
    }
    const personalizationLearning = personalizationPanel.querySelector(
      '[data-testid="personalization-learning-switch"] input',
    );
    if (!(personalizationLearning instanceof HTMLInputElement))
      return 'personalization-learning-switch';
    if (
      personalizationLearning.checked !==
      snapshot.personalization.learningEnabled
    ) {
      return 'personalization-learning-state';
    }
    if (!personalizationLearning.checked) {
      personalizationLearning.click();
      await wait(120);
      if (!personalizationLearning.checked)
        return 'personalization-learning-toggle';
      personalizationLearning.click();
      await wait(120);
      if (personalizationLearning.checked)
        return 'personalization-learning-restore';
    }
    const dictionaryLearning = personalizationPanel.querySelector(
      '[data-testid="dictionary-learning-switch"] input',
    );
    if (!(dictionaryLearning instanceof HTMLInputElement))
      return 'dictionary-learning-switch';
    if (dictionaryLearning.checked !== snapshot.dictionaryLearning?.enabled)
      return 'dictionary-learning-state';
    const learningWasEnabled = dictionaryLearning.checked;
    // Turning learning off clears private candidate state, so only exercise the
    // switch when it was already off and can be restored without data loss.
    if (!learningWasEnabled) {
      dictionaryLearning.click();
      await wait(120);
      if (!dictionaryLearning.checked) return 'dictionary-learning-toggle';
      dictionaryLearning.click();
      await wait(120);
      if (dictionaryLearning.checked) return 'dictionary-learning-restore';
    }

    const problemsTab = settingsRoot.querySelector('#settings-tab-problems');
    if (!problemsTab) return 'problems-tab';
    problemsTab.click();
    await wait(120);
    if (problemsTab.getAttribute('aria-selected') !== 'true')
      return 'problems-tab-state';
    const problemsPanel = settingsRoot.querySelector('#settings-panel-problems');
    if (!problemsPanel) return 'problems-panel';
    const automaticCollection = problemsPanel.querySelector(
      '[data-testid="automatic-error-collection-switch"] input',
    );
    if (!(automaticCollection instanceof HTMLInputElement))
      return 'automatic-error-collection-switch';
    if (
      automaticCollection.checked !==
      snapshot.settings.diagnostics.automaticCollection
    ) {
      return 'automatic-error-collection-state';
    }
    const automaticCollectionLabel = problemsPanel.querySelector(
      '[data-testid="automatic-error-collection-switch-label"]',
    );
    if (!automaticCollectionLabel)
      return 'automatic-error-collection-label';
    const collectionBeforeLabelClick = automaticCollection.checked;
    automaticCollectionLabel.click();
    await wait(120);
    if (automaticCollection.checked !== collectionBeforeLabelClick)
      return 'automatic-error-collection-label-toggle';
    const collectionWasEnabled = automaticCollection.checked;
    automaticCollection.click();
    await wait(120);
    if (automaticCollection.checked === collectionWasEnabled)
      return 'automatic-error-collection-toggle';
    automaticCollection.click();
    await wait(120);
    if (automaticCollection.checked !== collectionWasEnabled)
      return 'automatic-error-collection-restore';
    const showErrorDialogs = problemsPanel.querySelector(
      '[data-testid="show-error-dialogs-switch"] input',
    );
    if (!(showErrorDialogs instanceof HTMLInputElement))
      return 'show-error-dialogs-switch';
    if (
      showErrorDialogs.checked !== snapshot.settings.diagnostics.showErrorDialogs
    ) {
      return 'show-error-dialogs-state';
    }
    const renderedIssues = problemsPanel.querySelectorAll(
      '[role="button"][data-testid^="diagnostic-issue-"]',
    );
    if (renderedIssues.length > 10)
      return 'diagnostic-page-size:' + renderedIssues.length;
    if (
      diagnostics.issues.length > 10 &&
      !problemsPanel.querySelector('[data-testid="diagnostic-pagination"]')
    ) {
      return 'diagnostic-pagination';
    }
    if (
      diagnostics.issues.length > 0 &&
      !problemsPanel.querySelector('[data-testid="diagnostics-clear"]')
    ) {
      return 'diagnostics-clear';
    }

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

    const addSpeech = settingsRoot.querySelector(
      '[data-testid="provider-add-speech"]',
    );
    if (!addSpeech) return 'provider-speech-trigger';
    addSpeech.click();
    await wait(200);
    dialogs = [...document.querySelectorAll('[role="dialog"]')];
    if (dialogs.length !== 2)
      return 'speech-provider-dialog-count:' + dialogs.length;
    const speechProviderDialog = dialogs[dialogs.length - 1];
    const aliyunPreset = speechProviderDialog.querySelector(
      '[data-testid="provider-preset-aliyun-bailian-speech"]',
    );
    if (!aliyunPreset) return 'provider-aliyun-preset';
    aliyunPreset.click();
    await wait(200);
    const realtimeRoot = speechProviderDialog.querySelector(
      '[data-testid="aliyun-realtime-speech-switch"]',
    );
    const realtimeControl = realtimeRoot?.matches('[role="switch"]')
      ? realtimeRoot
      : realtimeRoot?.querySelector('[role="switch"]');
    if (!realtimeControl) return 'provider-aliyun-realtime-switch';
    if (realtimeControl.checked !== false)
      return 'provider-aliyun-realtime-initial';
    realtimeControl.click();
    await wait(80);
    if (realtimeControl.checked !== true)
      return 'provider-aliyun-realtime-toggle';
    const aliyunModel = speechProviderDialog.querySelector(
      '[data-testid="provider-model-input"]',
    );
    if (
      aliyunModel?.value !== 'qwen-audio-3.0-asr-flash-streaming'
    ) {
      return 'provider-aliyun-realtime-model';
    }
    speechProviderDialog.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }),
    );
    await wait(600);
    dialogs = [...document.querySelectorAll('[role="dialog"]')];
    if (dialogs.length !== 1)
      return 'speech-provider-dialog-close:' + dialogs.length;

    settingsRoot = document.querySelector('[data-testid="settings-dialog"]');
    const modelsClose = settingsRoot?.querySelector('[data-testid="settings-close"]');
    if (!modelsClose) return 'models-close';
    modelsClose.click();
    await wait(600);
    if (document.querySelectorAll('[role="dialog"]').length !== 0)
      return 'models-dialog-close';

    const historyTrigger = document.querySelector('[data-testid="history-open"]');
    if (!historyTrigger) return 'history-trigger';
    const historyLabel = historyTrigger.textContent?.trim();
    historyTrigger.click();
    await wait(200);
    if (!historyLabel || main.querySelector('h1')?.textContent?.trim() !== historyLabel)
      return 'history-heading';
    const historySummary = main.querySelector(
      '[data-testid^="history-details-summary-"]',
    );
    if (historySummary) {
      historySummary.click();
      await wait(120);
      const modelDetailsTrigger = main.querySelector(
        '[data-testid^="history-model-details-"]',
      );
      if (!modelDetailsTrigger) return 'history-model-details-trigger';
      modelDetailsTrigger.click();
      await wait(200);
      const modelDetailsRoot = document.querySelector(
        '[data-testid="history-model-details-dialog"]',
      );
      if (!modelDetailsRoot) return 'history-model-details-dialog';
      const modelDetailsDialog = modelDetailsRoot.matches('[role="dialog"]')
        ? modelDetailsRoot
        : modelDetailsRoot.querySelector('[role="dialog"]');
      if (!modelDetailsDialog) return 'history-model-details-dialog-role';
      const modelDetailsLabelledBy = modelDetailsDialog.getAttribute(
        'aria-labelledby',
      );
      if (!modelDetailsLabelledBy || !document.getElementById(modelDetailsLabelledBy))
        return 'history-model-details-label';
      const modelDetailsClose = modelDetailsRoot.querySelector(
        '[data-testid="history-model-details-close"]',
      );
      if (!modelDetailsClose) return 'history-model-details-close';
      modelDetailsClose.click();
      await wait(300);
      if (document.querySelector('[data-testid="history-model-details-dialog"]'))
        return 'history-model-details-stale';
    }

    const dictionaryTrigger = document.querySelector(
      '[data-testid="dictionary-open"]',
    );
    if (!dictionaryTrigger) return 'dictionary-trigger';
    const dictionaryLabel = dictionaryTrigger.textContent?.trim();
    dictionaryTrigger.click();
    await wait(120);
    if (!main.querySelector('form')) return 'dictionary-form';
    if (main.querySelector('[data-testid="dictionary-learning-switch"]'))
      return 'dictionary-learning-on-page';
    if (!dictionaryLabel || main.querySelector('h1')?.textContent?.trim() !== dictionaryLabel)
      return 'dictionary-heading';
    return 'ok';
  })()
`;

const responsiveSmokeTestSource = `
  (async () => {
    const wait = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds));
    const viewportWidth = document.documentElement.clientWidth;
    if (viewportWidth !== 375 && viewportWidth !== 860)
      return 'viewport:' + viewportWidth;

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

    const problemsTab = settingsRoot.querySelector('#settings-tab-problems');
    if (!problemsTab) return 'problems-tab';
    problemsTab.click();
    await wait(120);
    const problemsPanel = settingsRoot.querySelector('#settings-panel-problems');
    if (!problemsPanel) return 'problems-panel';
    if (problemsPanel.scrollWidth > problemsPanel.clientWidth + 1)
      return 'problems-horizontal-scroll';
    const showErrorDialogs = problemsPanel.querySelector(
      '[data-testid="show-error-dialogs-switch"] input',
    );
    if (!(showErrorDialogs instanceof HTMLInputElement))
      return 'show-error-dialogs-switch';
    const renderedIssues = problemsPanel.querySelectorAll(
      '[role="button"][data-testid^="diagnostic-issue-"]',
    );
    if (renderedIssues.length > 10)
      return 'diagnostic-page-size:' + renderedIssues.length;

    const modelsTab = settingsRoot.querySelector('#settings-tab-models');
    if (!modelsTab) return 'models-tab';
    modelsTab.click();
    await wait(120);

    const addText = modelsPanel.querySelector('[data-testid="provider-add-text"]');
    if (!addText) return 'provider-trigger';
    if (addText.getBoundingClientRect().height > 50)
      return 'provider-trigger-wrapped:' + addText.getBoundingClientRect().height;
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
  viewport: { height: number; mobile: boolean; width: number },
): Promise<string> => {
  const attachedHere = !webContents.debugger.isAttached();
  if (attachedHere) webContents.debugger.attach('1.3');
  try {
    await webContents.debugger.sendCommand(
      'Emulation.setDeviceMetricsOverride',
      {
        deviceScaleFactor: 1,
        height: viewport.height,
        mobile: viewport.mobile,
        screenHeight: viewport.height,
        screenWidth: viewport.width,
        width: viewport.width,
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
  const compactResult = await runResponsiveSmokeTest(webContents, {
    height: 600,
    mobile: false,
    width: 860,
  });
  if (compactResult !== 'ok') return `compact-${compactResult}`;
  const mobileResult = await runResponsiveSmokeTest(webContents, {
    height: 812,
    mobile: true,
    width: 375,
  });
  return mobileResult === 'ok' ? 'ok' : `responsive-${mobileResult}`;
};
