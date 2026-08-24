import type { WebContents } from 'electron';

// Locale-independent: selects by ARIA roles instead of visible copy.
const smokeTestSource = `
  (async () => {
    const wait = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds));
    const snapshot = await window.untypo?.getSnapshot();
    if (!snapshot || !Array.isArray(snapshot.dictionary)) return 'snapshot';
    const usage = await window.untypo?.getUsageStats();
    if (!usage || typeof usage.usageCount !== 'number') return 'usage';

    // The renderer must resolve to the current OS color preference.
    const bodyBackground = getComputedStyle(document.body).backgroundColor;
    const expectedBackground = matchMedia('(prefers-color-scheme: dark)').matches
      ? 'rgb(15, 20, 28)'
      : 'rgb(255, 255, 255)';
    if (bodyBackground !== expectedBackground)
      return 'palette:' + bodyBackground + ':' + expectedBackground;

    if (!document.querySelector('main h1')) return 'home-heading';
    const settingsTrigger = document.querySelector('[data-testid="settings-open"]');
    if (!settingsTrigger) return 'settings-trigger';
    settingsTrigger.click();
    await wait(120);
    const main = document.querySelector('main');
    if (!main?.querySelector('h1')) return 'settings-heading';
    if (!main.querySelector('input')) return 'settings-controls';
    const comboboxes = [...main.querySelectorAll('[role="combobox"]')];
    if (comboboxes.length === 0) return 'settings-combobox';

    const modelsTrigger = document.querySelector('[data-testid="models-open"]');
    if (!modelsTrigger) return 'models-trigger';
    modelsTrigger.click();
    await wait(120);
    const trigger = main.querySelector('[data-testid="provider-add"]');
    if (!trigger) return 'provider-trigger';
    trigger.click();
    await wait(250);
    const dialogs = [...document.querySelectorAll('[role="dialog"]')];
    const dialog = dialogs[dialogs.length - 1];
    if (!dialog) return 'dialog-open';
    const labelledBy = dialog.getAttribute('aria-labelledby');
    if (!labelledBy) return 'dialog-label';
    if (!document.getElementById(labelledBy)) return 'dialog-label-target';

    const control = dialog.querySelector('[role="switch"]');
    if (!control) return 'switch-missing';
    if (control.checked !== false) return 'switch-state';
    control.click();
    await wait(80);
    if (control.checked !== true) return 'switch-toggle';

    const unlabelled = [...dialog.querySelectorAll('input')].filter(
      (input) =>
        !(input.labels && input.labels.length > 0) &&
        !input.getAttribute('aria-labelledby') &&
        !input.getAttribute('aria-label'),
    );
    if (unlabelled.length > 0) return 'input-label:' + unlabelled.length;

    dialog.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }),
    );
    await wait(600);
    if (document.querySelectorAll('[role="dialog"]').length !== 0)
      return 'provider-dialog-close';

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

export const runRendererSmokeTest = async (
  webContents: WebContents,
): Promise<string> =>
  (await webContents.executeJavaScript(smokeTestSource)) as string;
