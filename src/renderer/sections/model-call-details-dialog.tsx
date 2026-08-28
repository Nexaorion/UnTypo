import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type {
  ClientHistoryModelCall,
  ClientHistoryRecord,
} from '../../shared/ipc.js';
import { useI18n } from '../i18n/context.js';
import { formatBytes, formatDuration } from '../logic/history.js';
import { tokens } from '../theme.js';

const Metric = ({ label, value }: { label: string; value: string }) => (
  <Paper
    variant="outlined"
    sx={{ flex: '1 1 132px', minWidth: 0, px: 1.75, py: 1.4 }}
  >
    <Typography color="text.secondary" variant="caption">
      {label}
    </Typography>
    <Typography sx={{ fontSize: 17, fontWeight: 750, mt: 0.25 }}>
      {value}
    </Typography>
  </Paper>
);

const DetailRow = ({ label, value }: { label: string; value: string }) => (
  <Stack
    direction="row"
    sx={{ gap: 2, justifyContent: 'space-between', minWidth: 0 }}
  >
    <Typography color="text.secondary" variant="caption">
      {label}
    </Typography>
    <Typography
      sx={{ fontWeight: 650, overflowWrap: 'anywhere', textAlign: 'right' }}
      variant="caption"
    >
      {value}
    </Typography>
  </Stack>
);

const TextBlock = ({ label, value }: { label: string; value: string }) => (
  <Stack sx={{ gap: 0.6 }}>
    <Typography color="text.secondary" variant="caption">
      {label}
    </Typography>
    <Box
      component="pre"
      sx={{
        bgcolor: 'action.hover',
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: `${tokens.radiusControl}px`,
        fontFamily: 'inherit',
        fontSize: 13,
        lineHeight: 1.65,
        m: 0,
        maxHeight: 220,
        overflow: 'auto',
        p: 1.5,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
    >
      {value}
    </Box>
  </Stack>
);

const ModelCallCard = ({
  call,
  index,
}: {
  call: ClientHistoryModelCall;
  index: number;
}) => {
  const { t } = useI18n();
  const isSpeech = call.kind === 'speech-recognition';
  const provider = call.providerName ?? call.providerType ?? call.providerId;

  return (
    <Paper
      data-testid={`history-model-call-${index}`}
      variant="outlined"
      sx={{ borderRadius: `${tokens.radiusControl}px`, p: 2 }}
    >
      <Stack sx={{ gap: 1.5 }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          sx={{ gap: 1, justifyContent: 'space-between' }}
        >
          <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
            <Chip
              label={
                isSpeech ? t('history.trace.speech') : t('history.trace.text')
              }
              size="small"
              variant="outlined"
            />
            <Chip
              color={call.status === 'success' ? 'success' : 'error'}
              label={
                call.status === 'success'
                  ? t('history.trace.success')
                  : t('history.trace.failed')
              }
              size="small"
            />
          </Stack>
          <Stack direction="row" sx={{ alignItems: 'baseline', gap: 1.25 }}>
            {call.firstOutputMs === undefined ? null : (
              <Typography color="text.secondary" variant="caption">
                {t('history.trace.firstOutput')}{' '}
                {formatDuration(call.firstOutputMs)}
              </Typography>
            )}
            <Typography sx={{ fontWeight: 760 }}>
              {formatDuration(call.durationMs)}
            </Typography>
          </Stack>
        </Stack>

        <Stack sx={{ gap: 0.5 }}>
          <DetailRow label={t('history.trace.provider')} value={provider} />
          {call.modelName ? (
            <DetailRow
              label={t('history.trace.model')}
              value={call.modelName}
            />
          ) : null}
          <DetailRow
            label={t('history.trace.profileId')}
            value={call.providerId}
          />
        </Stack>

        <Divider />

        {isSpeech ? (
          <Stack sx={{ gap: 0.5 }}>
            <Typography sx={{ fontWeight: 700 }} variant="subtitle2">
              {t('history.trace.input')}
            </Typography>
            <DetailRow
              label={t('history.trace.audioDuration')}
              value={formatDuration(call.input.audioDurationMs)}
            />
            <DetailRow
              label={t('history.trace.audioFormat')}
              value={call.input.mimeType}
            />
            <DetailRow
              label={t('history.trace.payloadSize')}
              value={formatBytes(call.input.payloadSizeBytes)}
            />
            <DetailRow
              label={t('history.trace.sampleRate')}
              value={`${call.input.sampleRateHz} Hz`}
            />
            <DetailRow
              label={t('history.trace.channels')}
              value={String(call.input.channels)}
            />
            <DetailRow
              label={t('history.trace.language')}
              value={call.input.language}
            />
            <DetailRow
              label={t('history.trace.dictionaryTerms')}
              value={String(call.input.dictionaryTermCount)}
            />
          </Stack>
        ) : (
          <Stack sx={{ gap: 1.25 }}>
            <Typography sx={{ fontWeight: 700 }} variant="subtitle2">
              {t('history.trace.input')}
            </Typography>
            <TextBlock
              label={t('history.trace.inputText')}
              value={call.input.text}
            />
            <Stack sx={{ gap: 0.5 }}>
              <DetailRow
                label={t('history.trace.language')}
                value={call.input.locale}
              />
              <DetailRow
                label={t('history.trace.defaultTarget')}
                value={call.input.defaultTargetLanguage}
              />
              {call.input.explicitTargetLanguage ? (
                <DetailRow
                  label={t('history.trace.explicitTarget')}
                  value={call.input.explicitTargetLanguage}
                />
              ) : null}
              <DetailRow
                label={t('history.trace.mode')}
                value={call.input.forcedIntent ?? t('history.trace.auto')}
              />
              <DetailRow
                label={t('history.trace.dictionaryTerms')}
                value={String(call.input.dictionaryTermCount)}
              />
              <DetailRow
                label={t('history.trace.dictionaryLearning')}
                value={
                  call.input.dictionaryLearningEnabled
                    ? t('history.trace.enabled')
                    : t('history.trace.disabled')
                }
              />
              {call.input.tone ? (
                <DetailRow
                  label={t('history.trace.tone')}
                  value={call.input.tone}
                />
              ) : null}
            </Stack>
          </Stack>
        )}

        {call.outputText ? (
          <TextBlock
            label={t('history.trace.output')}
            value={call.outputText}
          />
        ) : null}
        {call.error ? (
          <TextBlock label={t('history.trace.error')} value={call.error} />
        ) : null}
      </Stack>
    </Paper>
  );
};

export const ModelCallDetailsDialog = ({
  onClose,
  record,
}: {
  onClose: () => void;
  record?: ClientHistoryRecord;
}) => {
  const { t } = useI18n();
  const trace = record?.processingTrace;

  return (
    <Dialog
      aria-labelledby="history-model-details-title"
      data-testid="history-model-details-dialog"
      fullWidth
      maxWidth="md"
      onClose={onClose}
      open={record !== undefined}
    >
      <DialogTitle id="history-model-details-title">
        <Stack direction="row" sx={{ alignItems: 'center', gap: 1.25 }}>
          <InfoOutlinedIcon color="primary" />
          <Box>
            <Typography component="span" sx={{ fontSize: 20, fontWeight: 760 }}>
              {t('history.trace.title')}
            </Typography>
            {trace ? (
              <Typography
                color="text.secondary"
                sx={{ display: 'block' }}
                variant="caption"
              >
                {t('history.trace.operationId', { id: trace.operationId })}
              </Typography>
            ) : null}
          </Box>
        </Stack>
      </DialogTitle>
      <DialogContent dividers>
        {!trace ? (
          <Typography
            color="text.secondary"
            sx={{ py: 4, textAlign: 'center' }}
          >
            {t('history.trace.unavailable')}
          </Typography>
        ) : (
          <Stack sx={{ gap: 2.25 }}>
            <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
              <Metric
                label={t('history.trace.total')}
                value={formatDuration(trace.totalDurationMs)}
              />
              <Metric
                label={t('history.trace.recorder')}
                value={formatDuration(trace.recorderFinalizationMs)}
              />
              <Metric
                label={t('history.trace.modelProcessing')}
                value={formatDuration(trace.modelProcessingMs)}
              />
              {trace.confirmationMs === undefined ? null : (
                <Metric
                  label={t('history.trace.confirmation')}
                  value={formatDuration(trace.confirmationMs)}
                />
              )}
              <Metric
                label={t('history.trace.injection')}
                value={formatDuration(trace.injectionMs)}
              />
            </Stack>

            <Typography color="text.secondary" variant="caption">
              {t('history.trace.privacy')}
            </Typography>

            {trace.modelCalls.length === 0 ? (
              <Typography color="text.secondary">
                {t('history.trace.noCalls')}
              </Typography>
            ) : (
              <Stack sx={{ gap: 1.5 }}>
                {trace.modelCalls.map((call, index) => (
                  <ModelCallCard
                    call={call}
                    index={index}
                    key={`${call.kind}-${call.providerId}-${index}`}
                  />
                ))}
              </Stack>
            )}
          </Stack>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button data-testid="history-model-details-close" onClick={onClose}>
          {t('action.close')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
