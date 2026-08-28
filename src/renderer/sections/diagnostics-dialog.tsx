import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useEffect, useMemo, useState } from 'react';
import type { ClientDiagnosticIssue } from '../../shared/diagnostics.js';
import { useI18n } from '../i18n/context.js';
import {
  diagnosticKindKey,
  latestDiagnosticIssue,
} from '../logic/diagnostics.js';
import { describeError, type ClientStore } from '../state/client.js';
import { tokens } from '../theme.js';
import { useToast } from '../ui/toast.js';

const issueLog = (issue: ClientDiagnosticIssue): string => {
  const timeline = issue.timeline.map((entry) => {
    const context = entry.context
      ? ` ${JSON.stringify(entry.context, null, 2)}`
      : '';
    return `${new Date(entry.timestamp).toISOString()} ${entry.level.toUpperCase()} [${entry.scope}] ${entry.message}${context}`;
  });
  const stack = issue.error.stack ? `\n\n${issue.error.stack}` : '';
  return `${timeline.join('\n')}\n\n${issue.error.name}: ${issue.error.message}${stack}`;
};

export const DiagnosticsDialog = ({
  issueId,
  onOpenChange,
  open,
  store,
}: {
  issueId?: string;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  store: ClientStore;
}) => {
  const { locale, t } = useI18n();
  const notify = useToast();
  const issues = store.diagnostics?.issues ?? [];
  const [includeAudio, setIncludeAudio] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [acknowledging, setAcknowledging] = useState(false);
  const selectedIssue = issueId
    ? issues.find(({ id }) => id === issueId)
    : latestDiagnosticIssue(issues);
  const detailMode = issueId !== undefined;

  useEffect(() => setIncludeAudio(false), [selectedIssue?.id, open]);

  const log = useMemo(
    () => (selectedIssue ? issueLog(selectedIssue) : ''),
    [selectedIssue],
  );

  const exportSelected = async () => {
    if (!selectedIssue) return;
    setExporting(true);
    try {
      const result = await store.exportDiagnostics({
        includeAudio: includeAudio && selectedIssue.audioAvailable,
        issueIds: [selectedIssue.id],
      });
      if (!result.canceled) {
        notify(t('diagnostics.exported'), {
          description: result.filePath,
          type: 'success',
        });
      }
    } catch (error) {
      notify(t('diagnostics.exportFailed'), {
        description: describeError(error) ?? t('error.unknown'),
        type: 'error',
      });
    } finally {
      setExporting(false);
    }
  };

  const acknowledgeSelected = async () => {
    if (!selectedIssue) return;
    setAcknowledging(true);
    try {
      await store.acknowledgeDiagnostics([selectedIssue.id]);
      onOpenChange(false);
    } catch (error) {
      notify(t('diagnostics.acknowledgeFailed'), {
        description: describeError(error) ?? t('error.unknown'),
        type: 'error',
      });
    } finally {
      setAcknowledging(false);
    }
  };

  return (
    <Dialog
      aria-labelledby="diagnostics-dialog-title"
      data-testid="diagnostics-dialog"
      fullWidth
      maxWidth="md"
      onClose={() => onOpenChange(false)}
      open={open}
      slotProps={{ paper: { sx: { maxHeight: 'calc(100% - 32px)' } } }}
    >
      <DialogTitle id="diagnostics-dialog-title" sx={{ pb: 1.25 }}>
        <Stack direction="row" sx={{ alignItems: 'center', gap: 1.5 }}>
          <Box
            sx={{
              alignItems: 'center',
              bgcolor: 'error.light',
              borderRadius: '50%',
              color: 'error.main',
              display: 'inline-flex',
              height: 42,
              justifyContent: 'center',
              width: 42,
            }}
          >
            <ErrorOutlineRoundedIcon />
          </Box>
          <Box>
            <Typography component="span" sx={{ fontSize: 21, fontWeight: 760 }}>
              {t(detailMode ? 'diagnostics.detailTitle' : 'diagnostics.title')}
            </Typography>
            <Typography
              color="text.secondary"
              sx={{ display: 'block' }}
              variant="body2"
            >
              {selectedIssue
                ? t(
                    detailMode
                      ? 'diagnostics.detailSummary'
                      : 'diagnostics.latestSummary',
                  )
                : t('diagnostics.empty')}
            </Typography>
          </Box>
        </Stack>
      </DialogTitle>
      <DialogContent sx={{ pt: 1 }}>
        {selectedIssue ? (
          <Stack sx={{ gap: 2.25 }}>
            <Stack sx={{ gap: 0.75 }}>
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                sx={{ alignItems: { sm: 'center' }, gap: 1 }}
              >
                <Chip
                  color="error"
                  label={t(diagnosticKindKey(selectedIssue.kind))}
                  size="small"
                  variant="outlined"
                />
                <Typography color="text.secondary" variant="caption">
                  {new Intl.DateTimeFormat(locale, {
                    dateStyle: 'long',
                    timeStyle: 'medium',
                  }).format(selectedIssue.occurredAt)}
                </Typography>
              </Stack>
              <Typography sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}>
                {selectedIssue.error.message}
              </Typography>
              <Typography color="text.secondary" variant="body2">
                {t('diagnostics.source', { source: selectedIssue.source })}
              </Typography>
            </Stack>

            <Paper
              sx={{
                bgcolor: 'action.hover',
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: `${tokens.radiusControl}px`,
                overflow: 'hidden',
              }}
            >
              <Stack
                direction="row"
                sx={{ alignItems: 'center', gap: 1, px: 2, py: 1.25 }}
              >
                <DescriptionOutlinedIcon color="action" fontSize="small" />
                <Typography sx={{ fontSize: 13, fontWeight: 700 }}>
                  {t('diagnostics.logTitle')}
                </Typography>
              </Stack>
              <Box
                component="pre"
                data-testid="diagnostics-log"
                sx={{
                  borderTop: '1px solid',
                  borderTopColor: 'divider',
                  color: 'text.secondary',
                  fontFamily:
                    '"Cascadia Mono", "SFMono-Regular", Consolas, monospace',
                  fontSize: 11.5,
                  lineHeight: 1.65,
                  m: 0,
                  maxHeight: 270,
                  overflow: 'auto',
                  p: 2,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {log}
              </Box>
            </Paper>

            <Paper
              sx={{
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: `${tokens.radiusControl}px`,
                p: 2,
              }}
            >
              <FormControlLabel
                control={
                  <Checkbox
                    checked={includeAudio}
                    disabled={!selectedIssue.audioAvailable}
                    onChange={(event) => setIncludeAudio(event.target.checked)}
                  />
                }
                label={t('diagnostics.includeAudio')}
              />
              <Typography
                color="text.secondary"
                sx={{ pl: 4 }}
                variant="caption"
              >
                {selectedIssue.audioAvailable
                  ? t('diagnostics.audioHint')
                  : t('diagnostics.noAudio')}
              </Typography>
            </Paper>

            <Typography color="text.secondary" variant="caption">
              {t('diagnostics.privacy')}
            </Typography>
          </Stack>
        ) : (
          <Box sx={{ color: 'text.secondary', py: 6, textAlign: 'center' }}>
            {t('diagnostics.empty')}
          </Box>
        )}
      </DialogContent>
      <DialogActions
        sx={{
          alignItems: { xs: 'stretch', sm: 'center' },
          flexDirection: { xs: 'column-reverse', sm: 'row' },
          gap: 1,
          px: { xs: 2, sm: 3 },
          py: { xs: 1.75, sm: 2.25 },
          '& .MuiButton-root': {
            whiteSpace: 'nowrap',
            width: { xs: '100%', sm: 'auto' },
          },
        }}
      >
        <Button
          data-testid="diagnostics-later"
          onClick={() => onOpenChange(false)}
        >
          {t(detailMode ? 'action.close' : 'diagnostics.later')}
        </Button>
        {selectedIssue?.acknowledgedAt === undefined ? (
          <Button
            disabled={acknowledging}
            onClick={() => void acknowledgeSelected()}
            variant="outlined"
          >
            {t('diagnostics.acknowledge')}
          </Button>
        ) : null}
        <Button
          data-testid="diagnostics-export"
          disabled={!selectedIssue || exporting}
          onClick={() => void exportSelected()}
          startIcon={<DownloadRoundedIcon />}
          variant="contained"
        >
          {t('diagnostics.export')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
