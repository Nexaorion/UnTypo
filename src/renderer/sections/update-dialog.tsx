import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import LinearProgress from '@mui/material/LinearProgress';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { useI18n } from '../i18n/context.js';
import type { ClientStore } from '../state/client.js';
import { themeAlpha, themePalette, tokens } from '../theme.js';

export const UpdateDialog = ({
  onOpenChange,
  open,
  store,
}: {
  onOpenChange: (open: boolean) => void;
  open: boolean;
  store: ClientStore;
}) => {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const update = store.snapshot?.update;
  const status = update?.status ?? 'idle';
  const downloading = status === 'checking' || status === 'downloading';
  const downloaded = status === 'downloaded';
  const failed = status === 'error';
  const version = update?.availableVersion ?? update?.currentVersion ?? '';

  const retry = async () => {
    setBusy(true);
    try {
      if (update?.availableVersion) await store.downloadUpdate();
      else await store.checkForUpdates();
    } finally {
      setBusy(false);
    }
  };

  const icon = downloaded ? (
    <CheckRoundedIcon />
  ) : failed ? (
    <ErrorOutlineRoundedIcon />
  ) : (
    <DownloadRoundedIcon />
  );

  return (
    <Dialog
      fullWidth
      maxWidth="xs"
      onClose={() => onOpenChange(false)}
      open={open}
    >
      <DialogContent
        data-testid="update-dialog"
        sx={{ px: { xs: 3, sm: 4 }, pt: 4.5 }}
      >
        <Stack sx={{ alignItems: 'center', textAlign: 'center' }}>
          <Box
            sx={(currentTheme) => ({
              alignItems: 'center',
              backgroundColor: failed
                ? themeAlpha(themePalette(currentTheme).error.main, 0.1)
                : themeAlpha(themePalette(currentTheme).primary.main, 0.09),
              borderRadius: '50%',
              color: failed ? 'error.main' : 'text.primary',
              display: 'flex',
              height: 56,
              justifyContent: 'center',
              mb: 2.25,
              width: 56,
            })}
          >
            {icon}
          </Box>
          <Typography component="h2" sx={{ fontSize: 22, fontWeight: 740 }}>
            {downloaded
              ? t('update.readyTitle')
              : failed
                ? t('update.failedTitle')
                : downloading
                  ? t('update.updatingTitle')
                  : t('update.availableTitle')}
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 1 }} variant="body2">
            {downloaded
              ? t('update.readyDescription', { version })
              : failed
                ? t('update.failedDescription')
                : downloading
                  ? t('update.downloadingDescription', { version })
                  : t('update.availableDescription', { version })}
          </Typography>
          {downloading ? (
            <LinearProgress
              aria-label={t('update.progressLabel')}
              sx={{
                borderRadius: tokens.radiusControl,
                height: 7,
                mt: 3.5,
                width: '100%',
              }}
            />
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ justifyContent: 'center', px: 4, pb: 3.5, pt: 3 }}>
        {downloaded ? (
          <>
            <Button onClick={() => onOpenChange(false)} variant="outlined">
              {t('update.later')}
            </Button>
            <Button
              onClick={() => void store.installUpdate()}
              variant="contained"
            >
              {t('update.restartNow')}
            </Button>
          </>
        ) : downloading ? (
          <Button onClick={() => onOpenChange(false)} variant="outlined">
            {t('update.background')}
          </Button>
        ) : (
          <>
            <Button onClick={() => onOpenChange(false)} variant="text">
              {t('action.cancel')}
            </Button>
            <Button
              disabled={busy}
              onClick={() => void retry()}
              variant="contained"
            >
              {failed ? t('update.retry') : t('update.downloadNow')}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
};
