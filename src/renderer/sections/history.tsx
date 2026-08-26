import ContentCopyIcon from '@mui/icons-material/ContentCopyOutlined';
import Accordion from '@mui/material/Accordion';
import AccordionDetails from '@mui/material/AccordionDetails';
import AccordionSummary from '@mui/material/AccordionSummary';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useEffect, useState } from 'react';
import type { DictationIntent } from '../../core/providers/contracts.js';
import { useI18n } from '../i18n/context.js';
import type { MessageKey } from '../i18n/messages.js';
import { formatTimestamp } from '../logic/history.js';
import type { ClientStore } from '../state/client.js';
import { useAction } from '../state/use-action.js';
import { ConfirmDialog } from '../ui/confirm-dialog.js';
import { Card, EmptyState, Page, PageHeader } from '../ui/page.js';

const intentKey = (intent: DictationIntent): MessageKey =>
  intent === 'translation'
    ? 'intent.translation'
    : intent === 'instruction'
      ? 'intent.instruction'
      : 'intent.transcription';

export const HistorySection = ({ store }: { store: ClientStore }) => {
  const { locale, t } = useI18n();
  const { isPending, run } = useAction();
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    void store.reloadHistory().catch(() => undefined);
  }, [store.reloadHistory]);

  const copy = (text: string) =>
    void run('copy', () => store.copyText(text), {
      successMessage: t('history.copied'),
    });

  return (
    <Page>
      <PageHeader
        action={
          store.history.length > 0 ? (
            <Button
              color="error"
              onClick={() => setConfirming(true)}
              variant="text"
            >
              {t('history.clear')}
            </Button>
          ) : undefined
        }
        title={t('history.title')}
      />

      {store.history.length === 0 ? (
        <EmptyState>{t('history.empty')}</EmptyState>
      ) : (
        <Stack sx={{ gap: 1.5 }}>
          {store.history.map((record) => (
            <Card key={record.id}>
              <Stack
                direction="row"
                sx={{
                  alignItems: 'center',
                  gap: 1,
                  justifyContent: 'space-between',
                }}
              >
                <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
                  <Chip
                    label={t(intentKey(record.intent))}
                    size="small"
                    variant="outlined"
                  />
                  <Typography
                    color="text.secondary"
                    component="time"
                    variant="caption"
                  >
                    {formatTimestamp(record.createdAt, locale)}
                  </Typography>
                </Stack>
                <IconButton
                  aria-label={t('action.copy')}
                  onClick={() => copy(record.outputText)}
                  size="small"
                >
                  <ContentCopyIcon fontSize="small" />
                </IconButton>
              </Stack>

              <Typography sx={{ whiteSpace: 'pre-wrap' }} variant="body2">
                {record.outputText}
              </Typography>

              {record.rawTranscript &&
              record.rawTranscript !== record.outputText ? (
                <Accordion
                  disableGutters
                  square={false}
                  sx={{ bgcolor: 'transparent' }}
                >
                  <AccordionSummary sx={{ minHeight: 0, px: 0 }}>
                    <Typography color="text.secondary" variant="caption">
                      {t('history.raw')}
                    </Typography>
                  </AccordionSummary>
                  <AccordionDetails sx={{ px: 0 }}>
                    <Typography color="text.secondary" variant="body2">
                      {record.rawTranscript}
                    </Typography>
                  </AccordionDetails>
                </Accordion>
              ) : null}
            </Card>
          ))}
        </Stack>
      )}

      {store.historyExhausted ? null : (
        <Stack direction="row" sx={{ justifyContent: 'center' }}>
          <Button
            disabled={isPending('more')}
            onClick={() => void run('more', () => store.loadMoreHistory())}
            variant="outlined"
          >
            {t('action.loadMore')}
          </Button>
        </Stack>
      )}

      <ConfirmDialog
        cancelLabel={t('action.cancel')}
        confirmLabel={t('action.clear')}
        onConfirm={() =>
          void run('clear', async () => {
            await store.clearHistory();
            setConfirming(false);
          })
        }
        onOpenChange={setConfirming}
        open={confirming}
        pending={isPending('clear')}
        title={t('history.clearConfirm')}
      />
    </Page>
  );
};
