import { useState } from 'react';
import { AppShell, type AppPage } from './app-shell.js';
import { I18nProvider, useI18n } from './i18n/context.js';
import { DictionarySection } from './sections/dictionary.js';
import { HistorySection } from './sections/history.js';
import { HomeSection } from './sections/home.js';
import { ProvidersSection } from './sections/providers.js';
import { SettingsSection } from './sections/settings.js';
import { useClientStore, type ClientStore } from './state/client.js';
import { ToastProvider } from './ui/toast.js';

const Shell = ({ store }: { store: ClientStore }) => {
  const [page, setPage] = useState<AppPage>('home');
  const userName = store.runtime?.userName ?? 'User';

  const content =
    page === 'history' ? (
      <HistorySection store={store} />
    ) : page === 'dictionary' ? (
      <DictionarySection store={store} />
    ) : page === 'settings' ? (
      <SettingsSection store={store} />
    ) : page === 'models' ? (
      <ProvidersSection store={store} />
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
    <AppShell onSelect={setPage} page={page} version={store.runtime?.version}>
      {content}
    </AppShell>
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
