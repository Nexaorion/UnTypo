import BackupRoundedIcon from '@mui/icons-material/BackupRounded';
import CloudDownloadRoundedIcon from '@mui/icons-material/CloudDownloadRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useCallback, useEffect, useState } from 'react';
import type { ClientSyncSnapshot, SyncBackupInfo } from '../../shared/sync.js';
import { useI18n } from '../i18n/context.js';
import { formatTimestamp } from '../logic/history.js';
import type { ClientStore } from '../state/client.js';
import { useAction } from '../state/use-action.js';
import { ConfirmDialog } from '../ui/confirm-dialog.js';
import { Card, EmptyState, Page, PageHeader } from '../ui/page.js';
import { SwitchField } from '../ui/switch-field.js';
import { SyncSettingsDialog } from './sync-settings-dialog.js';

const isConfigured = (sync: ClientSyncSnapshot): boolean => {
  if (!sync.backupCodeConfigured || !sync.providerId) return false;
  if (sync.providerId === 's3') {
    return Boolean(
      sync.s3?.endpoint &&
      sync.s3.bucket &&
      sync.s3.accessKeyConfigured &&
      sync.s3.secretAccessKeyConfigured,
    );
  }
  return Boolean(sync.webdav?.url && sync.webdav.username && sync.webdav.passwordConfigured);
};

export const SyncSection = ({ store }: { store: ClientStore }) => {
  const { locale, t } = useI18n();
  const { pendingKey, run } = useAction();
  const sync = store.snapshot?.sync;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [backups, setBackups] = useState<readonly SyncBackupInfo[]>([]);
  const [listState, setListState] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle');
  const [refreshToken, setRefreshToken] = useState(0);
  const [backupToApply, setBackupToApply] = useState<SyncBackupInfo>();
  const [backupToDelete, setBackupToDelete] = useState<SyncBackupInfo>();
  const configured = sync ? isConfigured(sync) : false;
  const listRemoteBackups = store.listRemoteBackups;

  const loadBackups = useCallback(async () => {
    if (!configured) {
      setBackups([]);
      setListState('idle');
      return;
    }
    setListState('loading');
    try {
      setBackups(await listRemoteBackups());
      setListState('loaded');
    } catch {
      setListState('error');
    }
  }, [configured, listRemoteBackups]);

  useEffect(() => {
    void loadBackups();
  }, [loadBackups, refreshToken]);

  if (!sync) {
    return (
      <Page>
        <PageHeader title={t('sync.title')} />
      </Page>
    );
  }

  const toggleEnabled = (enabled: boolean) =>
    void run('toggle-sync', () => store.updateSyncConfig({ enabled }));

  const createBackup = () =>
    void run(
      'create-backup',
      async () => {
        const result = await store.createBackup();
        if (!result.success) throw new Error(result.error ?? t('error.unknown'));
        await loadBackups();
      },
      { successMessage: t('sync.backupCreated') },
    );

  const applyBackup = () => {
    if (!backupToApply) return;
    const selected = backupToApply;
    void run(
      'apply-backup',
      async () => {
        const result = await store.applyBackup(selected.path);
        if (!result.success) throw new Error(result.error ?? t('error.unknown'));
        await store.reloadHistory();
        await loadBackups();
        setBackupToApply(undefined);
      },
      { successMessage: t('sync.applied') },
    );
  };

  const deleteBackup = () => {
    if (!backupToDelete) return;
    const selected = backupToDelete;
    void run(
      'delete-backup',
      async () => {
        await store.deleteBackup(selected.path);
        await loadBackups();
        setBackupToDelete(undefined);
      },
      { successMessage: t('sync.deleted') },
    );
  };

  const backupDescription = (
    backup: SyncBackupInfo,
    key: 'sync.applyConfirm' | 'sync.deleteConfirm',
  ) =>
    t(key, {
      date: formatTimestamp(backup.createdAt, locale),
      device: backup.deviceName || t('sync.unknownDevice'),
    });

  return (
    <Page>
      <PageHeader
        action={
          <Stack
            direction="row"
            sx={{
              flexWrap: 'wrap',
              gap: 1,
              justifyContent: { xs: 'flex-start', sm: 'flex-end' },
            }}
          >
            <Button
              data-testid="sync-settings-open"
              onClick={() => setSettingsOpen(true)}
              startIcon={<SettingsOutlinedIcon />}
              variant="outlined"
            >
              {t('sync.openSettings')}
            </Button>
            <Button
              data-testid="sync-backup-now"
              disabled={!sync.enabled || !configured || Boolean(pendingKey)}
              onClick={createBackup}
              startIcon={<BackupRoundedIcon />}
              variant="contained"
            >
              {t('sync.backupNow')}
            </Button>
          </Stack>
        }
        title={t('sync.title')}
      />
      <Stack
        sx={{
          borderBottom: '1px solid',
          borderBottomColor: 'divider',
          pb: 2.5,
        }}
      >
        <SwitchField
          checked={sync.enabled}
          disabled={pendingKey === 'toggle-sync'}
          label={t('sync.enabled')}
          onCheckedChange={toggleEnabled}
          testId="sync-enabled"
        />
      </Stack>
      <Card title={t('sync.backups')}>
        {!configured ? <EmptyState>{t('sync.notConfigured')}</EmptyState> : null}
        {configured && listState === 'loading' ? (
          <Stack
            direction="row"
            sx={{
              alignItems: 'center',
              color: 'text.secondary',
              gap: 1.5,
              py: 3,
            }}
          >
            <CircularProgress size={20} />
            <Typography variant="body2">{t('sync.loadingBackups')}</Typography>
          </Stack>
        ) : null}
        {configured && listState === 'error' ? (
          <Stack sx={{ alignItems: 'flex-start', gap: 1.5 }}>
            <EmptyState>{t('error.unknown')}</EmptyState>
            <Button onClick={() => void loadBackups()} variant="outlined">
              {t('action.refresh')}
            </Button>
          </Stack>
        ) : null}
        {configured && listState === 'loaded' && backups.length === 0 ? (
          <EmptyState>{t('sync.emptyBackups')}</EmptyState>
        ) : null}
        {configured && listState === 'loaded' && backups.length > 0 ? (
          <Stack divider={<Divider flexItem />}>
            {backups.map((backup) => (
              <Stack
                data-testid="sync-backup-row"
                direction="row"
                key={backup.path}
                sx={{ alignItems: 'center', gap: 2, minHeight: 72, py: 1.5 }}
              >
                <Stack
                  direction={{ xs: 'column', sm: 'row' }}
                  sx={{ flex: 1, gap: { xs: 0.5, sm: 5 }, minWidth: 0 }}
                >
                  <Stack sx={{ minWidth: 0 }}>
                    <Typography color="text.secondary" variant="caption">
                      {t('sync.backupDate')}
                    </Typography>
                    <Typography sx={{ overflowWrap: 'anywhere' }} variant="body2">
                      {formatTimestamp(backup.createdAt, locale)}
                    </Typography>
                  </Stack>
                  <Stack sx={{ minWidth: 0 }}>
                    <Typography color="text.secondary" variant="caption">
                      {t('sync.backupDevice')}
                    </Typography>
                    <Typography sx={{ overflowWrap: 'anywhere' }} variant="body2">
                      {backup.deviceName || t('sync.unknownDevice')}
                    </Typography>
                  </Stack>
                </Stack>
                <Stack direction="row" sx={{ flex: 'none', gap: 0.5 }}>
                  <Tooltip title={t('sync.apply')}>
                    <span>
                      <IconButton
                        aria-label={t('sync.apply')}
                        disabled={Boolean(pendingKey)}
                        onClick={() => setBackupToApply(backup)}
                      >
                        <CloudDownloadRoundedIcon />
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip title={t('sync.delete')}>
                    <span>
                      <IconButton
                        aria-label={t('sync.delete')}
                        color="error"
                        disabled={Boolean(pendingKey)}
                        onClick={() => setBackupToDelete(backup)}
                      >
                        <DeleteOutlineRoundedIcon />
                      </IconButton>
                    </span>
                  </Tooltip>
                </Stack>
              </Stack>
            ))}
          </Stack>
        ) : null}
      </Card>
      {settingsOpen ? (
        <SyncSettingsDialog
          onOpenChange={setSettingsOpen}
          onSaved={() => setRefreshToken((current) => current + 1)}
          open
          store={store}
          sync={sync}
        />
      ) : null}
      <ConfirmDialog
        cancelLabel={t('action.cancel')}
        confirmColor="primary"
        confirmLabel={t('sync.apply')}
        description={
          backupToApply ? backupDescription(backupToApply, 'sync.applyConfirm') : undefined
        }
        onConfirm={applyBackup}
        onOpenChange={(open) => {
          if (!open && pendingKey !== 'apply-backup') setBackupToApply(undefined);
        }}
        open={Boolean(backupToApply)}
        pending={pendingKey === 'apply-backup'}
        title={t('sync.applyTitle')}
      />
      <ConfirmDialog
        cancelLabel={t('action.cancel')}
        confirmLabel={t('sync.delete')}
        description={
          backupToDelete ? backupDescription(backupToDelete, 'sync.deleteConfirm') : undefined
        }
        onConfirm={deleteBackup}
        onOpenChange={(open) => {
          if (!open && pendingKey !== 'delete-backup') setBackupToDelete(undefined);
        }}
        open={Boolean(backupToDelete)}
        pending={pendingKey === 'delete-backup'}
        title={t('sync.deleteTitle')}
      />
    </Page>
  );
};
