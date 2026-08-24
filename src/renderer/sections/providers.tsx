import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import type { ClientProviderSummary } from '../../shared/ipc.js';
import { useI18n } from '../i18n/context.js';
import {
  emptyProviderForm,
  type ProviderFormState,
} from '../logic/provider-form.js';
import type { ClientStore } from '../state/client.js';
import { useAction } from '../state/use-action.js';
import { ConfirmDialog } from '../ui/confirm-dialog.js';
import { Card, EmptyState, Page, PageHeader } from '../ui/page.js';
import { ProviderDialog } from './provider-dialog.js';

const asString = (value: unknown): string =>
  typeof value === 'string' ? value : '';

const formFromSummary = (
  summary: ClientProviderSummary,
): ProviderFormState => ({
  allowInsecurePrivateEndpoint:
    summary.values.allowInsecurePrivateEndpoint === true,
  apiKey: '',
  baseUrl: asString(summary.values.baseUrl),
  id: summary.id,
  textModel: asString(summary.values.textModel),
  transcriptionModel: asString(summary.values.transcriptionModel),
});

export const ProvidersSection = ({ store }: { store: ClientStore }) => {
  const { t } = useI18n();
  const { isPending, run } = useAction();
  const [form, setForm] = useState<ProviderFormState | null>(null);
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const providers = store.snapshot?.providers ?? [];
  const activeId = store.snapshot?.settings.dictation.activeProviderProfileId;

  return (
    <Page>
      <PageHeader
        action={
          <Button
            data-testid="provider-add"
            onClick={() => {
              setEditing(false);
              setForm(emptyProviderForm());
            }}
            variant="contained"
          >
            {t('provider.add')}
          </Button>
        }
        title={t('provider.title')}
      />

      {providers.length === 0 ? (
        <EmptyState>{t('provider.empty')}</EmptyState>
      ) : (
        <Stack sx={{ gap: 1.5 }}>
          {providers.map((provider) => (
            <Card key={provider.id}>
              <Stack
                direction="row"
                sx={{
                  alignItems: 'flex-start',
                  flexWrap: 'wrap',
                  gap: 2,
                  justifyContent: 'space-between',
                }}
              >
                <Stack sx={{ gap: 0.75, minWidth: 0 }}>
                  <Stack
                    direction="row"
                    sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1 }}
                  >
                    <Typography sx={{ fontSize: 14, fontWeight: 600 }}>
                      {provider.id}
                    </Typography>
                    {provider.id === activeId ? (
                      <Chip
                        color="primary"
                        label={t('provider.active')}
                        size="small"
                        variant="outlined"
                      />
                    ) : null}
                  </Stack>
                  <Typography color="text.secondary" variant="caption">
                    {asString(provider.values.textModel)} ·{' '}
                    {asString(provider.values.transcriptionModel)}
                  </Typography>
                </Stack>

                <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
                  {provider.id === activeId ? null : (
                    <Button
                      color="inherit"
                      disabled={isPending(`activate-${provider.id}`)}
                      onClick={() =>
                        void run(`activate-${provider.id}`, () =>
                          store.updateSettings({
                            dictation: { activeProviderProfileId: provider.id },
                          }),
                        )
                      }
                      variant="text"
                    >
                      {t('provider.activate')}
                    </Button>
                  )}
                  <Button
                    color="inherit"
                    disabled={isPending(`test-${provider.id}`)}
                    onClick={() =>
                      void run(
                        `test-${provider.id}`,
                        () => store.testProvider(provider.id),
                        { successMessage: t('provider.testOk') },
                      )
                    }
                    variant="text"
                  >
                    {t('action.test')}
                  </Button>
                  <Button
                    onClick={() => {
                      setEditing(true);
                      setForm(formFromSummary(provider));
                    }}
                    variant="outlined"
                  >
                    {t('action.edit')}
                  </Button>
                  <Button
                    color="error"
                    onClick={() => setRemoving(provider.id)}
                    variant="text"
                  >
                    {t('action.remove')}
                  </Button>
                </Stack>
              </Stack>
            </Card>
          ))}
        </Stack>
      )}

      <ProviderDialog
        editing={editing}
        form={form}
        onClose={() => setForm(null)}
        onSaved={() => setForm(null)}
        store={store}
      />

      <ConfirmDialog
        cancelLabel={t('action.cancel')}
        confirmLabel={t('action.remove')}
        onConfirm={() => {
          const profileId = removing;
          if (!profileId) return;
          void run('remove', async () => {
            await store.removeProvider(profileId);
            setRemoving(null);
          });
        }}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        open={removing !== null}
        pending={isPending('remove')}
        title={t('provider.removeConfirm', { id: removing ?? '' })}
      />
    </Page>
  );
};
