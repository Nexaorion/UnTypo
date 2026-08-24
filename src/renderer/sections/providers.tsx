import GraphicEqRoundedIcon from '@mui/icons-material/GraphicEqRounded';
import TextFieldsRoundedIcon from '@mui/icons-material/TextFieldsRounded';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useMemo, useState, type ReactElement } from 'react';
import type { ClientProviderSummary } from '../../shared/ipc.js';
import { useI18n, type Translate } from '../i18n/context.js';
import {
  resolveProviderPreset,
  type ProviderKind,
} from '../logic/provider-catalog.js';
import {
  emptyProviderForm,
  providerFormFromSummary,
  type ProviderFormState,
} from '../logic/provider-form.js';
import type { ClientStore } from '../state/client.js';
import { useAction } from '../state/use-action.js';
import { ConfirmDialog } from '../ui/confirm-dialog.js';
import { Card, EmptyState, Page, PageHeader } from '../ui/page.js';
import { ProviderIcon } from '../ui/provider-icon.js';
import { ProviderDialog } from './provider-dialog.js';

const asString = (value: unknown): string =>
  typeof value === 'string' ? value : '';

const providerPresentation = (
  provider: ClientProviderSummary,
  t: Translate,
) => {
  const preset = resolveProviderPreset({
    baseUrl: asString(provider.values.baseUrl),
    kind: provider.kind,
    presetId: asString(provider.values.presetId),
    providerId: provider.providerId,
  });
  return {
    baseUrl: asString(provider.values.baseUrl),
    icon: preset.icon,
    model: asString(provider.values.model),
    name: asString(provider.values.name) || provider.id,
    presetName: t(preset.labelKey),
  };
};

const ProviderCard = ({
  active,
  isPending,
  onActivate,
  onEdit,
  onRemove,
  onTest,
  provider,
}: {
  active: boolean;
  isPending: (key: string) => boolean;
  onActivate: () => void;
  onEdit: () => void;
  onRemove: () => void;
  onTest: () => void;
  provider: ClientProviderSummary;
}) => {
  const { t } = useI18n();
  const presentation = providerPresentation(provider, t);

  return (
    <Card>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        sx={{
          alignItems: { xs: 'stretch', sm: 'center' },
          gap: 2,
          justifyContent: 'space-between',
        }}
      >
        <Stack
          direction="row"
          sx={{ alignItems: 'center', gap: 1.5, minWidth: 0 }}
        >
          <ProviderIcon icon={presentation.icon} />
          <Stack sx={{ gap: 0.35, minWidth: 0 }}>
            <Stack
              direction="row"
              sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 0.8 }}
            >
              <Typography sx={{ fontSize: 14.5, fontWeight: 700 }}>
                {presentation.name}
              </Typography>
              {active ? (
                <Chip
                  color="primary"
                  label={t('provider.active')}
                  size="small"
                  variant="outlined"
                />
              ) : null}
            </Stack>
            <Typography color="text.secondary" variant="caption">
              {presentation.presetName} · {presentation.model}
            </Typography>
            <Typography
              color="text.disabled"
              sx={{ overflowWrap: 'anywhere' }}
              variant="caption"
            >
              {presentation.baseUrl}
            </Typography>
          </Stack>
        </Stack>

        <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.75 }}>
          {active ? null : (
            <Button
              color="inherit"
              disabled={isPending(`activate-${provider.id}`)}
              onClick={onActivate}
              variant="text"
            >
              {t('provider.activate')}
            </Button>
          )}
          <Button
            color="inherit"
            disabled={isPending(`test-${provider.id}`)}
            onClick={onTest}
            variant="text"
          >
            {t('action.test')}
          </Button>
          <Button onClick={onEdit} variant="outlined">
            {t('action.edit')}
          </Button>
          <Button color="error" onClick={onRemove} variant="text">
            {t('action.remove')}
          </Button>
        </Stack>
      </Stack>
    </Card>
  );
};

const ProviderKindSection = ({
  activeId,
  addLabel,
  description,
  emptyLabel,
  icon,
  isPending,
  kind,
  onActivate,
  onAdd,
  onEdit,
  onRemove,
  onTest,
  providers,
  title,
}: {
  activeId?: string;
  addLabel: string;
  description: string;
  emptyLabel: string;
  icon: ReactElement;
  isPending: (key: string) => boolean;
  kind: ProviderKind;
  onActivate: (provider: ClientProviderSummary) => void;
  onAdd: () => void;
  onEdit: (provider: ClientProviderSummary) => void;
  onRemove: (provider: ClientProviderSummary) => void;
  onTest: (provider: ClientProviderSummary) => void;
  providers: readonly ClientProviderSummary[];
  title: string;
}) => (
  <Stack data-testid={`provider-section-${kind}`} sx={{ gap: 2 }}>
    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      sx={{
        alignItems: { xs: 'stretch', sm: 'center' },
        gap: 2,
        justifyContent: 'space-between',
      }}
    >
      <Stack direction="row" sx={{ alignItems: 'flex-start', gap: 1.5 }}>
        <Stack
          sx={{
            alignItems: 'center',
            bgcolor: 'action.hover',
            borderRadius: 2.5,
            color: 'text.secondary',
            height: 40,
            justifyContent: 'center',
            width: 40,
          }}
        >
          {icon}
        </Stack>
        <Stack sx={{ gap: 0.4 }}>
          <Typography component="h2" variant="h2">
            {title}
          </Typography>
          <Typography color="text.secondary" variant="body2">
            {description}
          </Typography>
        </Stack>
      </Stack>
      <Button
        data-testid={`provider-add-${kind}`}
        onClick={onAdd}
        variant="contained"
      >
        {addLabel}
      </Button>
    </Stack>

    {providers.length === 0 ? (
      <EmptyState>{emptyLabel}</EmptyState>
    ) : (
      <Stack sx={{ gap: 1.25 }}>
        {providers.map((provider) => (
          <ProviderCard
            active={provider.id === activeId}
            isPending={isPending}
            key={provider.id}
            onActivate={() => onActivate(provider)}
            onEdit={() => onEdit(provider)}
            onRemove={() => onRemove(provider)}
            onTest={() => onTest(provider)}
            provider={provider}
          />
        ))}
      </Stack>
    )}
  </Stack>
);

export const ProvidersSection = ({ store }: { store: ClientStore }) => {
  const { t } = useI18n();
  const { isPending, run } = useAction();
  const [form, setForm] = useState<ProviderFormState | null>(null);
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState<ClientProviderSummary | null>(null);

  const providers = store.snapshot?.providers ?? [];
  const existingIds = useMemo(
    () => new Set(providers.map((provider) => provider.id)),
    [providers],
  );
  const textProviders = providers.filter(
    (provider) => provider.kind === 'text',
  );
  const speechProviders = providers.filter(
    (provider) => provider.kind === 'speech',
  );
  const dictation = store.snapshot?.settings.dictation;

  const addProvider = (kind: ProviderKind) => {
    setEditing(false);
    setForm(emptyProviderForm(kind, existingIds));
  };

  const activateProvider = (provider: ClientProviderSummary) => {
    void run(`activate-${provider.id}`, () =>
      store.updateSettings({
        dictation:
          provider.kind === 'text'
            ? { activeTextProviderProfileId: provider.id }
            : { activeSpeechProviderProfileId: provider.id },
      }),
    );
  };

  const testProvider = (provider: ClientProviderSummary) => {
    void run(`test-${provider.id}`, () => store.testProvider(provider.id), {
      successMessage: t('provider.testOk'),
    });
  };

  const editProvider = (provider: ClientProviderSummary) => {
    setEditing(true);
    setForm(providerFormFromSummary(provider));
  };

  return (
    <Page>
      <PageHeader title={t('provider.title')} />
      <ProviderKindSection
        activeId={dictation?.activeTextProviderProfileId}
        addLabel={t('provider.addText')}
        description={t('provider.textDescription')}
        emptyLabel={t('provider.emptyText')}
        icon={<TextFieldsRoundedIcon fontSize="small" />}
        isPending={isPending}
        kind="text"
        onActivate={activateProvider}
        onAdd={() => addProvider('text')}
        onEdit={editProvider}
        onRemove={setRemoving}
        onTest={testProvider}
        providers={textProviders}
        title={t('provider.textTitle')}
      />
      <ProviderKindSection
        activeId={dictation?.activeSpeechProviderProfileId}
        addLabel={t('provider.addSpeech')}
        description={t('provider.speechDescription')}
        emptyLabel={t('provider.emptySpeech')}
        icon={<GraphicEqRoundedIcon fontSize="small" />}
        isPending={isPending}
        kind="speech"
        onActivate={activateProvider}
        onAdd={() => addProvider('speech')}
        onEdit={editProvider}
        onRemove={setRemoving}
        onTest={testProvider}
        providers={speechProviders}
        title={t('provider.speechTitle')}
      />

      <ProviderDialog
        editing={editing}
        existingIds={existingIds}
        form={form}
        onClose={() => setForm(null)}
        onSaved={() => setForm(null)}
        store={store}
      />

      <ConfirmDialog
        cancelLabel={t('action.cancel')}
        confirmLabel={t('action.remove')}
        onConfirm={() => {
          const profileId = removing?.id;
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
        title={t('provider.removeConfirm', {
          id: removing ? providerPresentation(removing, t).name : '',
        })}
      />
    </Page>
  );
};
