import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import VisibilityOffRoundedIcon from '@mui/icons-material/VisibilityOffRounded';
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useId, useState } from 'react';
import type {
  ClientSyncConfigUpdate,
  ClientSyncSnapshot,
  SyncProviderId,
} from '../../shared/sync.js';
import { useI18n } from '../i18n/context.js';
import type { ClientStore } from '../store/client.js';
import { useAction } from '../store/use-action.js';
import { ConfirmDialog } from '../ui/confirm-dialog.js';
import { Field } from '../ui/field.js';
import { SwitchField } from '../ui/switch-field.js';

const emptyS3 = {
  accessKeyId: '',
  bucket: '',
  endpoint: '',
  forcePathStyle: false,
  prefix: 'untypo/',
  region: '',
  secretAccessKey: '',
};

const emptyWebDav = {
  basePath: '/untypo/',
  password: '',
  url: '',
  username: '',
};

export const SyncSettingsDialog = ({
  onOpenChange,
  onSaved,
  open,
  store,
  sync,
}: {
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  open: boolean;
  store: ClientStore;
  sync: ClientSyncSnapshot;
}) => {
  const { t } = useI18n();
  const titleId = useId();
  const { pendingKey, run } = useAction();
  const [providerId, setProviderId] = useState<SyncProviderId>(sync.providerId ?? 's3');
  const [s3, setS3] = useState({
    accessKeyId: '',
    bucket: sync.s3?.bucket ?? '',
    endpoint: sync.s3?.endpoint ?? '',
    forcePathStyle: sync.s3?.forcePathStyle ?? false,
    prefix: sync.s3?.prefix ?? emptyS3.prefix,
    region: sync.s3?.region ?? '',
    secretAccessKey: '',
  });
  const [webdav, setWebDav] = useState({
    basePath: sync.webdav?.basePath ?? emptyWebDav.basePath,
    password: '',
    url: sync.webdav?.url ?? '',
    username: sync.webdav?.username ?? '',
  });
  const [customCode, setCustomCode] = useState('');
  const [revealedCode, setRevealedCode] = useState<string>();
  const [showCode, setShowCode] = useState(false);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);

  const configUpdate = (): ClientSyncConfigUpdate => ({
    providerId,
    s3: {
      bucket: s3.bucket,
      endpoint: s3.endpoint,
      forcePathStyle: s3.forcePathStyle,
      prefix: s3.prefix,
      region: s3.region,
      ...(s3.accessKeyId.trim() ? { accessKeyId: s3.accessKeyId } : {}),
      ...(s3.secretAccessKey.trim() ? { secretAccessKey: s3.secretAccessKey } : {}),
    },
    webdav: {
      basePath: webdav.basePath,
      url: webdav.url,
      username: webdav.username,
      ...(webdav.password.trim() ? { password: webdav.password } : {}),
    },
    ...(customCode.trim() ? { backupCode: customCode.trim() } : {}),
  });

  const save = () => {
    void (async () => {
      const succeeded = await run(
        'save-sync-settings',
        () => store.updateSyncConfig(configUpdate()),
        { successMessage: t('sync.saved') },
      );
      if (!succeeded) return;
      onOpenChange(false);
      onSaved();
    })();
  };

  const testConnection = () =>
    void run(
      'test-sync-connection',
      async () => {
        await store.updateSyncConfig(configUpdate());
        await store.testSyncConnection();
      },
      { successMessage: t('sync.tested') },
    );

  const regenerate = () =>
    void run(
      'generate-backup-code',
      async () => {
        const code = await store.generateBackupCode();
        setRevealedCode(code);
        setShowCode(true);
        setCustomCode('');
        setConfirmRegenerate(false);
      },
      { successMessage: t('sync.saved') },
    );

  const copyCode = () => {
    if (!revealedCode) return;
    void run('copy-backup-code', () => store.copyText(revealedCode), {
      successMessage: t('sync.copied'),
    });
  };

  const close = () => {
    if (pendingKey) return;
    onOpenChange(false);
  };

  return (
    <>
      <Dialog
        aria-labelledby={titleId}
        data-testid="sync-settings-dialog"
        fullWidth
        maxWidth="sm"
        onClose={close}
        open={open}
        slotProps={{
          paper: {
            sx: {
              maxHeight: { xs: 'calc(100% - 16px)', sm: 'calc(100% - 48px)' },
              width: { xs: 'calc(100% - 16px)', sm: '100%' },
            },
          },
        }}
      >
        <DialogTitle
          id={titleId}
          sx={{
            alignItems: 'center',
            display: 'flex',
            justifyContent: 'space-between',
          }}
        >
          {t('sync.settingsTitle')}
          <IconButton
            aria-label={t('action.close')}
            data-testid="sync-settings-close"
            disabled={Boolean(pendingKey)}
            onClick={close}
          >
            <CloseRoundedIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers sx={{ overflowX: 'hidden' }}>
          <Stack sx={{ gap: 3 }}>
            <Stack sx={{ gap: 2 }}>
              <Typography component="h2" variant="h2">
                {t('sync.group.storage')}
              </Typography>
              <Field
                label={t('sync.provider')}
                onChange={(event) => setProviderId(event.target.value as SyncProviderId)}
                select
                value={providerId}
              >
                <MenuItem value="s3">{t('sync.provider.s3')}</MenuItem>
                <MenuItem value="webdav">{t('sync.provider.webdav')}</MenuItem>
              </Field>
              {providerId === 's3' ? (
                <Stack sx={{ gap: 2 }}>
                  <Field
                    label={t('sync.s3.endpoint')}
                    onChange={(event) =>
                      setS3((current) => ({
                        ...current,
                        endpoint: event.target.value,
                      }))
                    }
                    value={s3.endpoint}
                  />
                  <Field
                    label={t('sync.s3.region')}
                    onChange={(event) =>
                      setS3((current) => ({
                        ...current,
                        region: event.target.value,
                      }))
                    }
                    value={s3.region}
                  />
                  <Field
                    label={t('sync.s3.bucket')}
                    onChange={(event) =>
                      setS3((current) => ({
                        ...current,
                        bucket: event.target.value,
                      }))
                    }
                    value={s3.bucket}
                  />
                  <Field
                    label={t('sync.s3.prefix')}
                    onChange={(event) =>
                      setS3((current) => ({
                        ...current,
                        prefix: event.target.value,
                      }))
                    }
                    value={s3.prefix}
                  />
                  <Field
                    label={t('sync.s3.accessKey')}
                    onChange={(event) =>
                      setS3((current) => ({
                        ...current,
                        accessKeyId: event.target.value,
                      }))
                    }
                    placeholder={sync.s3?.accessKeyConfigured ? '••••••••' : undefined}
                    value={s3.accessKeyId}
                  />
                  <Field
                    label={t('sync.s3.secretKey')}
                    onChange={(event) =>
                      setS3((current) => ({
                        ...current,
                        secretAccessKey: event.target.value,
                      }))
                    }
                    placeholder={sync.s3?.secretAccessKeyConfigured ? '••••••••' : undefined}
                    type="password"
                    value={s3.secretAccessKey}
                  />
                  <SwitchField
                    checked={s3.forcePathStyle}
                    label={t('sync.forcePathStyle')}
                    onCheckedChange={(checked) =>
                      setS3((current) => ({
                        ...current,
                        forcePathStyle: checked,
                      }))
                    }
                  />
                </Stack>
              ) : (
                <Stack sx={{ gap: 2 }}>
                  <Field
                    label={t('sync.webdav.url')}
                    onChange={(event) =>
                      setWebDav((current) => ({
                        ...current,
                        url: event.target.value,
                      }))
                    }
                    value={webdav.url}
                  />
                  <Field
                    label={t('sync.webdav.username')}
                    onChange={(event) =>
                      setWebDav((current) => ({
                        ...current,
                        username: event.target.value,
                      }))
                    }
                    value={webdav.username}
                  />
                  <Field
                    label={t('sync.webdav.password')}
                    onChange={(event) =>
                      setWebDav((current) => ({
                        ...current,
                        password: event.target.value,
                      }))
                    }
                    placeholder={sync.webdav?.passwordConfigured ? '••••••••' : undefined}
                    type="password"
                    value={webdav.password}
                  />
                  <Field
                    label={t('sync.webdav.basePath')}
                    onChange={(event) =>
                      setWebDav((current) => ({
                        ...current,
                        basePath: event.target.value,
                      }))
                    }
                    value={webdav.basePath}
                  />
                </Stack>
              )}
            </Stack>
            <Divider />
            <Stack sx={{ gap: 2 }}>
              <Typography component="h2" variant="h2">
                {t('sync.group.security')}
              </Typography>
              <Typography color="text.secondary" variant="body2">
                {t('sync.backupCodeHint')}
              </Typography>
              {!sync.customBackupCode ? (
                <Stack direction="row" sx={{ alignItems: 'flex-end', gap: 0.5 }}>
                  <Field
                    label={t('sync.backupCode')}
                    slotProps={{ htmlInput: { readOnly: true } }}
                    value={
                      showCode && revealedCode
                        ? revealedCode
                        : sync.backupCodeConfigured
                          ? t('sync.backupCodeHidden')
                          : ''
                    }
                  />
                  <Tooltip title={showCode ? t('sync.hideBackupCode') : t('sync.showBackupCode')}>
                    <span>
                      <IconButton
                        aria-label={showCode ? t('sync.hideBackupCode') : t('sync.showBackupCode')}
                        disabled={!revealedCode}
                        onClick={() => setShowCode((current) => !current)}
                        sx={{ height: 44, width: 44 }}
                      >
                        {showCode ? <VisibilityOffRoundedIcon /> : <VisibilityRoundedIcon />}
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip title={t('sync.copyBackupCode')}>
                    <span>
                      <IconButton
                        aria-label={t('sync.copyBackupCode')}
                        disabled={!revealedCode}
                        onClick={copyCode}
                        sx={{ height: 44, width: 44 }}
                      >
                        <ContentCopyRoundedIcon />
                      </IconButton>
                    </span>
                  </Tooltip>
                </Stack>
              ) : null}
              <Field
                helperText={t('sync.backupCodeCustomHint')}
                label={t('sync.backupCodeCustom')}
                onChange={(event) => setCustomCode(event.target.value)}
                placeholder={sync.customBackupCode ? t('sync.backupCodeHidden') : undefined}
                type="password"
                value={customCode}
              />
              <Button
                color="error"
                onClick={() => setConfirmRegenerate(true)}
                sx={{ alignSelf: 'flex-start' }}
                variant="outlined"
              >
                {sync.customBackupCode
                  ? t('sync.backupCodeRestore')
                  : t('sync.backupCodeRegenerate')}
              </Button>
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ gap: 1, px: 3, py: 2 }}>
          <Button disabled={Boolean(pendingKey)} onClick={testConnection} variant="outlined">
            {t('sync.test')}
          </Button>
          <Button color="inherit" disabled={Boolean(pendingKey)} onClick={close} variant="text">
            {t('action.cancel')}
          </Button>
          <Button disabled={Boolean(pendingKey)} onClick={save} variant="contained">
            {t('action.save')}
          </Button>
        </DialogActions>
      </Dialog>
      <ConfirmDialog
        cancelLabel={t('action.cancel')}
        confirmLabel={
          sync.customBackupCode ? t('sync.backupCodeRestore') : t('sync.backupCodeRegenerate')
        }
        description={
          sync.customBackupCode
            ? t('sync.backupCodeRestoreConfirm')
            : t('sync.backupCodeRegenerateConfirm')
        }
        onConfirm={regenerate}
        onOpenChange={setConfirmRegenerate}
        open={confirmRegenerate}
        pending={pendingKey === 'generate-backup-code'}
        title={
          sync.customBackupCode ? t('sync.backupCodeRestoreTitle') : t('sync.backupCodeRegenerate')
        }
      />
    </>
  );
};
