import { useState } from 'react';
import { AppShell, type AppPage } from './app-shell.js';
import { I18nProvider, useI18n } from './i18n/context.js';
import { DictionarySection } from './sections/dictionary.js';
import { HistorySection } from './sections/history.js';
import { HomeSection } from './sections/home.js';
import {
  SettingsDialog,
  type SettingsTab,
} from './sections/settings-dialog.js';
import { useClientStore, type ClientStore } from './state/client.js';
import { ToastProvider } from './ui/toast.js';

const Shell = ({ store }: { store: ClientStore }) => {
  const [page, setPage] = useState<AppPage>('home');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('settings');
  const userName = store.runtime?.userName ?? 'User';

  const content =
    page === 'history' ? (
      <HistorySection store={store} />
    ) : page === 'dictionary' ? (
      <DictionarySection store={store} />
    ) : (
      <HomeSection
        history={store.history}
        hotkey={
          store.snapshot?.settings.dictation.hotkeyAccelerator ??
          'Control+Shift+Space'
        }
        onOpenHistory={() => setPage('history')}
        usage={store.usage}
        userName={userName}
      />
    );

  return (
    <>
      <AppShell
        onOpenSettings={(tab) => {
          setSettingsTab(tab);
          setSettingsOpen(true);
        }}
        onSelect={setPage}
        page={page}
        version={store.runtime?.version}
      >
        {content}
      </AppShell>
      <SettingsDialog
        onOpenChange={setSettingsOpen}
        onTabChange={setSettingsTab}
        open={settingsOpen}
        store={store}
        tab={settingsTab}
      />
    </>
  );
};

const Localized = ({ store }: { store: ClientStore }) => {
  const { t } = useI18n();
  return (
    <ToastProvider closeLabel={t('action.close')}>
      <Shell store={store} />
    </ToastProvider>
  );
};

export const App = () => {
  const store = useClientStore();
  const locale = store.snapshot?.settings.general.locale ?? 'zh-CN';

  return (
    <I18nProvider locale={locale}>
      <Localized store={store} />
    </I18nProvider>
  );
};
