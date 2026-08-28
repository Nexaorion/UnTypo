import { useEffect, useRef, useState } from 'react';
import { AppShell, type AppPage } from './app-shell.js';
import { I18nProvider, useI18n } from './i18n/context.js';
import { DictionarySection } from './sections/dictionary.js';
import { DiagnosticsDialog } from './sections/diagnostics-dialog.js';
import { HistorySection } from './sections/history.js';
import { HomeSection } from './sections/home.js';
import {
  SettingsDialog,
  type SettingsTab,
} from './sections/settings-dialog.js';
import { UpdateDialog } from './sections/update-dialog.js';
import { useClientStore, type ClientStore } from './state/client.js';
import { ToastProvider } from './ui/toast.js';

const Shell = ({ store }: { store: ClientStore }) => {
  const [page, setPage] = useState<AppPage>('home');
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('settings');
  const [updateOpen, setUpdateOpen] = useState(false);
  const knownDiagnosticIds = useRef<Set<string> | undefined>(undefined);
  const userName = store.runtime?.userName ?? 'User';
  const showErrorDialogs =
    store.snapshot?.settings.diagnostics.showErrorDialogs ?? false;

  useEffect(() => {
    if (!store.diagnostics) return;
    const issues = store.diagnostics.issues;
    const known = knownDiagnosticIds.current;
    if (!known) {
      knownDiagnosticIds.current = new Set(issues.map(({ id }) => id));
      return;
    }
    const newPendingIssue = issues.find(
      ({ acknowledgedAt, id }) =>
        acknowledgedAt === undefined && !known.has(id),
    );
    for (const { id } of issues) known.add(id);
    if (showErrorDialogs && newPendingIssue) setDiagnosticsOpen(true);
  }, [showErrorDialogs, store.diagnostics]);

  useEffect(() => {
    const status = store.snapshot?.update.status;
    if (status === 'downloading' || status === 'downloaded') {
      setUpdateOpen(true);
    }
  }, [store.snapshot?.update.status]);

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
          'Control+Alt+Space'
        }
        onOpenHistory={() => setPage('history')}
        usage={store.usage}
        userName={userName}
      />
    );

  return (
    <>
      <AppShell
        onOpenUpdate={() => setUpdateOpen(true)}
        onOpenSettings={(tab) => {
          setSettingsTab(tab);
          setSettingsOpen(true);
        }}
        onSelect={setPage}
        page={page}
        update={store.snapshot?.update}
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
      <DiagnosticsDialog
        onOpenChange={setDiagnosticsOpen}
        open={diagnosticsOpen}
        store={store}
      />
      <UpdateDialog
        onOpenChange={setUpdateOpen}
        open={updateOpen}
        store={store}
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
