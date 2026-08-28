import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import DeleteSweepRoundedIcon from '@mui/icons-material/DeleteSweepRounded';
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import ListItemButton from '@mui/material/ListItemButton';
import Pagination from '@mui/material/Pagination';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useEffect, useState } from 'react';
import { useI18n } from '../i18n/context.js';
import { diagnosticKindKey } from '../logic/diagnostics.js';
import type { ClientStore } from '../state/client.js';
import { useAction } from '../state/use-action.js';
import { tokens } from '../theme.js';
import { ConfirmDialog } from '../ui/confirm-dialog.js';
import { Card, EmptyState, Page, PageHeader } from '../ui/page.js';
import { SwitchField } from '../ui/switch-field.js';
import { DiagnosticsDialog } from './diagnostics-dialog.js';

const pageSize = 10;

export const ProblemsSection = ({ store }: { store: ClientStore }) => {
  const { locale, t } = useI18n();
  const { isPending, run } = useAction();
  const settings = store.snapshot?.settings.diagnostics;
  const issues = store.diagnostics?.issues ?? [];
  const pendingCount = issues.filter(
    ({ acknowledgedAt }) => acknowledgedAt === undefined,
  ).length;
  const [selectedIssueId, setSelectedIssueId] = useState<string>();
  const [page, setPage] = useState(1);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const pageCount = Math.max(1, Math.ceil(issues.length / pageSize));
  const visibleIssues = issues.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => {
    if (selectedIssueId && !issues.some(({ id }) => id === selectedIssueId)) {
      setSelectedIssueId(undefined);
    }
  }, [issues, selectedIssueId]);

  useEffect(() => {
    setPage((current) => Math.min(current, pageCount));
  }, [pageCount]);

  if (!settings) {
    return (
      <Page>
        <PageHeader title={t('problems.title')} />
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader title={t('problems.title')} />

      <Card title={t('problems.preferences')}>
        <Stack sx={{ gap: 2.5 }}>
          <SwitchField
            checked={settings.automaticCollection}
            description={t('problems.automaticCollectionHint')}
            disabled={isPending('automaticCollection')}
            label={t('problems.automaticCollection')}
            onCheckedChange={(checked) =>
              void run('automaticCollection', () =>
                store.updateSettings({
                  diagnostics: { automaticCollection: checked },
                }),
              )
            }
            testId="automatic-error-collection-switch"
          />
          <SwitchField
            checked={settings.showErrorDialogs}
            description={t('problems.showErrorDialogsHint')}
            disabled={isPending('showErrorDialogs')}
            label={t('problems.showErrorDialogs')}
            onCheckedChange={(checked) =>
              void run('showErrorDialogs', () =>
                store.updateSettings({
                  diagnostics: { showErrorDialogs: checked },
                }),
              )
            }
            testId="show-error-dialogs-switch"
          />
          <Typography color="text.secondary" variant="caption">
            {t('problems.privacy')}
          </Typography>
        </Stack>
      </Card>

      <Card title={t('problems.issueList')}>
        <Stack sx={{ gap: 1.5 }}>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            sx={{
              alignItems: { xs: 'stretch', sm: 'center' },
              gap: 1,
              justifyContent: 'space-between',
            }}
          >
            <Typography color="text.secondary" variant="body2">
              {issues.length > 0
                ? t('problems.issueCount', {
                    count: String(issues.length),
                    pending: String(pendingCount),
                  })
                : t('problems.issueListHint')}
            </Typography>
            {issues.length > 0 ? (
              <Button
                color="error"
                data-testid="diagnostics-clear"
                disabled={isPending('clearDiagnostics')}
                onClick={() => setConfirmingClear(true)}
                startIcon={<DeleteSweepRoundedIcon />}
                sx={{ alignSelf: { xs: 'flex-start', sm: 'center' } }}
                variant="text"
              >
                {t('problems.clear')}
              </Button>
            ) : null}
          </Stack>
          {issues.length === 0 ? (
            <EmptyState>{t('diagnostics.empty')}</EmptyState>
          ) : (
            <Paper
              data-testid="diagnostic-issue-list"
              sx={{
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: `${tokens.radiusControl}px`,
                overflow: 'hidden',
              }}
            >
              <Stack divider={<Divider flexItem />}>
                {visibleIssues.map((issue) => (
                  <ListItemButton
                    aria-label={t('problems.openIssue', {
                      message: issue.error.message,
                    })}
                    data-testid={`diagnostic-issue-${issue.id}`}
                    key={issue.id}
                    onClick={() => setSelectedIssueId(issue.id)}
                    sx={{
                      alignItems: 'center',
                      borderRadius: 0,
                      gap: 1.5,
                      minWidth: 0,
                      px: { xs: 1.5, sm: 2 },
                      py: 1.5,
                    }}
                  >
                    <Box
                      sx={{
                        alignItems: 'center',
                        bgcolor: 'error.light',
                        borderRadius: '50%',
                        color: 'error.main',
                        display: { xs: 'none', sm: 'inline-flex' },
                        flex: '0 0 auto',
                        height: 36,
                        justifyContent: 'center',
                        width: 36,
                      }}
                    >
                      <ErrorOutlineRoundedIcon fontSize="small" />
                    </Box>
                    <Stack sx={{ flex: 1, gap: 0.6, minWidth: 0 }}>
                      <Typography
                        sx={{
                          fontSize: 13.5,
                          fontWeight: 650,
                          overflowWrap: 'anywhere',
                        }}
                      >
                        {issue.error.message}
                      </Typography>
                      <Stack
                        direction="row"
                        sx={{
                          alignItems: 'center',
                          flexWrap: 'wrap',
                          gap: 0.75,
                        }}
                      >
                        <Chip
                          label={t(diagnosticKindKey(issue.kind))}
                          size="small"
                          variant="outlined"
                        />
                        {issue.acknowledgedAt !== undefined ? (
                          <Chip
                            label={t('problems.acknowledged')}
                            size="small"
                          />
                        ) : null}
                        <Typography color="text.secondary" variant="caption">
                          {new Intl.DateTimeFormat(locale, {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          }).format(issue.occurredAt)}
                        </Typography>
                      </Stack>
                    </Stack>
                    <ChevronRightRoundedIcon
                      color="action"
                      sx={{ display: { xs: 'none', sm: 'block' } }}
                    />
                  </ListItemButton>
                ))}
              </Stack>
            </Paper>
          )}
          {pageCount > 1 ? (
            <Pagination
              aria-label={t('problems.pagination')}
              boundaryCount={1}
              count={pageCount}
              data-testid="diagnostic-pagination"
              getItemAriaLabel={(type, itemPage, selected) => {
                if (type === 'first') return t('problems.paginationFirst');
                if (type === 'last') return t('problems.paginationLast');
                if (type === 'next') return t('problems.paginationNext');
                if (type === 'previous')
                  return t('problems.paginationPrevious');
                return t(
                  selected
                    ? 'problems.paginationCurrent'
                    : 'problems.paginationGoTo',
                  { page: String(itemPage) },
                );
              }}
              onChange={(_event, nextPage) => setPage(nextPage)}
              page={page}
              shape="rounded"
              siblingCount={0}
              size="small"
              sx={{ alignSelf: 'center', pt: 0.5 }}
            />
          ) : null}
        </Stack>
      </Card>

      <ConfirmDialog
        cancelLabel={t('action.cancel')}
        confirmLabel={t('action.clear')}
        description={t('problems.clearDescription')}
        onConfirm={() =>
          void run(
            'clearDiagnostics',
            async () => {
              await store.clearDiagnostics();
              setPage(1);
              setConfirmingClear(false);
            },
            { successMessage: t('problems.clearSuccess') },
          )
        }
        onOpenChange={setConfirmingClear}
        open={confirmingClear}
        pending={isPending('clearDiagnostics')}
        title={t('problems.clearConfirm')}
      />

      <DiagnosticsDialog
        issueId={selectedIssueId}
        onOpenChange={(open) => {
          if (!open) setSelectedIssueId(undefined);
        }}
        open={selectedIssueId !== undefined}
        store={store}
      />
    </Page>
  );
};
