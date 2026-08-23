import type { WebContents } from 'electron';

const smokeTestSource = `
  (async () => {
    const wait = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds));
    const findButton = (label) =>
      [...document.querySelectorAll('button')].find(
        (button) => button.textContent?.trim() === label,
      );
    const snapshot = await window.untypo?.getSnapshot();
    if (!snapshot || !Array.isArray(snapshot.dictionary)) return false;
    const switchControl = document.querySelector(
      '[data-testid="clipboard-switch"]',
    );
    if (!switchControl || switchControl.getAttribute('aria-checked') !== 'true')
      return false;
    switchControl.click();
    await wait(50);
    if (switchControl.getAttribute('aria-checked') !== 'false') return false;

    findButton('Open dialog')?.click();
    await wait(200);
    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog || !dialog.textContent?.includes('Provider preview'))
      return false;
    findButton('Save preview')?.click();
    await wait(200);

    findButton('Show toast')?.click();
    await wait(50);
    if (!document.body.textContent?.includes('Preview saved')) return false;

    const translationTab = [...document.querySelectorAll('[role="tab"]')].find(
      (tab) => tab.textContent?.trim() === 'Translation',
    );
    translationTab?.click();
    await wait(50);
    return translationTab?.getAttribute('aria-selected') === 'true';
  })()
`;

export const runRendererSmokeTest = async (
  webContents: WebContents,
): Promise<boolean> =>
  (await webContents.executeJavaScript(smokeTestSource)) as boolean;
