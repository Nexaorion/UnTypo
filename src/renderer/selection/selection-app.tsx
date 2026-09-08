import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import MicNoneRoundedIcon from '@mui/icons-material/MicNoneRounded';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import LinearProgress from '@mui/material/LinearProgress';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useEffect, useState } from 'react';
import type {
  SelectionAPI,
  SelectionState,
} from '../../shared/selection-ipc.js';
import { I18nProvider, useI18n } from '../i18n/context.js';
import { tokens } from '../theme.js';

declare global {
  interface Window {
    selection: SelectionAPI;
  }
}

export const SelectionApp = () => {
  const [state, setState] = useState<SelectionState>();
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    let active = true;
    let received = false;
    const remove = window.selection.onChanged((next) => {
      received = true;
      setState(next);
    });
    void window.selection
      .getState()
      .then((next) => {
        if (active && !received) setState(next);
      })
      .catch(() => {
        if (active) setUnavailable(true);
      });
    return () => {
      active = false;
      remove();
    };
  }, []);
  const locale =
    state?.locale ?? (navigator.language.startsWith('zh') ? 'zh-CN' : 'en-US');
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  return (
    <I18nProvider locale={locale}>
      {state ? (
        <SelectionPanel key={state.sessionId} state={state} />
      ) : (
        <LoadingPanel unavailable={unavailable} />
      )}
    </I18nProvider>
  );
};

const LoadingPanel = ({ unavailable }: { unavailable: boolean }) => {
  const { t } = useI18n();
  return (
    <Paper sx={{ m: 0.5, p: 3 }}>
      {unavailable ? (
        <Alert severity="error">{t('selection.error.capture')}</Alert>
      ) : (
        <LinearProgress aria-label={t('selection.loading')} />
      )}
    </Paper>
  );
};

const SelectionPanel = ({ state }: { state: SelectionState }) => {
  const { t, locale } = useI18n();
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [actionFailed, setActionFailed] = useState(false);
  const processing = state.phase === 'processing';
  useEffect(() => {
    setCopied(false);
  }, [state.output]);
  const act = async (action: () => Promise<void>): Promise<boolean> => {
    setPending(true);
    setActionFailed(false);
    try {
      await action();
      return true;
    } catch {
      setActionFailed(true);
      return false;
    } finally {
      setPending(false);
    }
  };
  return (
    <Paper
      component="main"
      aria-labelledby="selection-title"
      data-phase={state.phase}
      sx={{
        m: 0.5,
        p: { xs: 1.5, sm: 2 },
        height: 'calc(100dvh - 8px)',
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: `${tokens.radiusDialog}px`,
        display: 'flex',
        flexDirection: 'column',
        gap: 1.5,
        overflow: 'auto',
        animation: `selection-enter ${tokens.duration}ms ease-out`,
        '@keyframes selection-enter': {
          from: { opacity: 0, transform: 'translateY(6px)' },
          to: { opacity: 1, transform: 'translateY(0)' },
        },
        '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
      }}
    >
      <Stack
        direction="row"
        sx={{ alignItems: 'center', gap: 1, flexShrink: 0 }}
      >
        <AutoAwesomeRoundedIcon fontSize="small" />
        <Typography
          id="selection-title"
          component="h1"
          variant="subtitle1"
          sx={{ flex: 1, fontWeight: 700 }}
        >
          UnTypo{' '}
          <Box
            component="span"
            sx={{ color: 'text.secondary', fontWeight: 400 }}
          >
            {t('selection.title')}
          </Box>
        </Typography>
        <IconButton
          aria-label={t('action.close')}
          disabled={pending && !processing}
          onClick={() => {
            void act(() => window.selection.close(state.sessionId));
          }}
        >
          <CloseRoundedIcon fontSize="small" />
        </IconButton>
      </Stack>
      {state.characters > 0 ? (
        <Typography variant="caption" color="text.secondary">
          {t('selection.count', {
            count: new Intl.NumberFormat(locale).format(state.characters),
          })}
        </Typography>
      ) : null}
      <Stack
        direction="row"
        sx={{
          gap: 1.25,
          alignItems: 'flex-start',
          px: 1,
          py: 1,
          flexShrink: 0,
        }}
      >
        <MicNoneRoundedIcon sx={{ color: 'text.secondary', mt: 0.25 }} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography component="h2" variant="caption" color="text.secondary">
            {t('selection.spokenInput')}
          </Typography>
          <Typography
            data-selection-instruction
            sx={{
              whiteSpace: 'pre-wrap',
              overflowWrap: 'anywhere',
              maxHeight: '22dvh',
              overflowY: 'auto',
            }}
          >
            {state.instruction || t('selection.listening')}
          </Typography>
        </Box>
        {processing ? (
          <Button
            onClick={() => {
              void act(() => window.selection.cancel(state.sessionId));
            }}
          >
            {t('action.cancel')}
          </Button>
        ) : null}
      </Stack>
      {state.error ? (
        <Alert severity="error">{t(`selection.error.${state.error}`)}</Alert>
      ) : null}
      {actionFailed ? (
        <Alert severity="error">{t('selection.error.action')}</Alert>
      ) : null}
      <Paper
        variant="outlined"
        sx={{
          borderRadius: `${tokens.radiusCard}px`,
          minHeight: 120,
          flex: '1 0 120px',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <Stack
          direction="row"
          sx={{
            px: 2,
            py: 0.5,
            alignItems: 'center',
            gap: 1,
            borderBottom: '1px solid',
            borderColor: 'divider',
          }}
        >
          <AutoAwesomeRoundedIcon
            fontSize="small"
            sx={{ color: 'text.secondary' }}
          />
          <Typography component="h2" variant="subtitle2" sx={{ flex: 1 }}>
            {t(
              state.intent === 'translation'
                ? 'selection.translation'
                : 'selection.answer',
            )}
          </Typography>
          <IconButton
            aria-label={t(copied ? 'selection.copied' : 'action.copy')}
            disabled={!state.output || processing || pending}
            onClick={() => {
              void act(() => window.selection.copy(state.sessionId)).then(
                (success) => {
                  if (success) setCopied(true);
                },
              );
            }}
          >
            <ContentCopyRoundedIcon fontSize="small" />
          </IconButton>
        </Stack>
        {processing ? (
          <LinearProgress aria-label={t('selection.processing')} />
        ) : null}
        <Box
          sx={{
            p: 2,
            overflowY: 'auto',
            maxHeight: '45dvh',
            overflowWrap: 'anywhere',
          }}
          aria-busy={processing}
        >
          <Typography
            data-selection-output
            variant="body1"
            sx={{ whiteSpace: 'pre-wrap', lineHeight: 1.75 }}
            color={state.output ? 'text.primary' : 'text.secondary'}
          >
            {state.output ||
              t(processing ? 'selection.processing' : 'selection.empty')}
          </Typography>
        </Box>
      </Paper>
      <Stack
        direction="row"
        sx={{ alignItems: 'center', gap: 1, flexShrink: 0 }}
      >
        <Typography
          role="status"
          variant="caption"
          color="text.secondary"
          sx={{ flex: 1 }}
        >
          {t(
            copied
              ? 'selection.copied'
              : state.editable
                ? 'selection.preview'
                : 'selection.readOnly',
          )}
        </Typography>
        {state.characters > 0 && state.instruction ? (
          <Button
            disabled={processing || pending}
            onClick={() => {
              void act(() => window.selection.retry(state.sessionId));
            }}
          >
            {t('selection.retry')}
          </Button>
        ) : null}
        {state.editable ? (
          <Button
            variant="outlined"
            disabled={!state.output || processing || pending}
            onClick={() => {
              void act(() => window.selection.replace(state.sessionId));
            }}
          >
            {t('selection.replace')}
          </Button>
        ) : null}
      </Stack>
    </Paper>
  );
};
