import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useId, useState } from 'react';
import { useI18n } from '../i18n/context.js';
import {
  getProviderPreset,
  getProviderPresets,
  TEXT_ENDPOINT_TYPES,
} from '../logic/provider-catalog.js';
import {
  selectProviderPreset,
  selectTextEndpointType,
  setAliyunRealtimeSpeechEnabled,
  toProviderInput,
  validateProviderForm,
  type ProviderFormErrorCode,
  type ProviderFormErrors,
  type ProviderFormState,
} from '../logic/provider-form.js';
import type { ClientStore } from '../state/client.js';
import { useAction } from '../state/use-action.js';
import { Field } from '../ui/field.js';
import { ProviderIcon } from '../ui/provider-icon.js';
import { SwitchField } from '../ui/switch-field.js';

interface ProviderDialogProps {
  editing: boolean;
  existingIds: ReadonlySet<string>;
  form: ProviderFormState | null;
  onClose: () => void;
  onSaved: () => void;
  store: ClientStore;
}

interface ProviderDialogFlowProps extends Omit<ProviderDialogProps, 'form'> {
  initialForm: ProviderFormState;
  titleId: string;
}

const ProviderDialogFlow = ({
  editing,
  existingIds,
  initialForm,
  onClose,
  onSaved,
  store,
  titleId,
}: ProviderDialogFlowProps) => {
  const { t } = useI18n();
  const { isPending, run } = useAction();
  const [draft, setDraft] = useState(initialForm);
  const [errors, setErrors] = useState<ProviderFormErrors>({});
  const [step, setStep] = useState<'details' | 'picker'>(
    editing ? 'details' : 'picker',
  );
  const presets = getProviderPresets(draft.kind);
  const selectedPreset = getProviderPreset(draft.presetId);
  const isAliyun = draft.providerId === 'aliyun-bailian-speech';
  const isCustomText =
    draft.kind === 'text' && draft.presetId === 'custom-text';

  const errorText = (code?: ProviderFormErrorCode): string | undefined => {
    if (!code) return undefined;
    if (code === 'invalidId') return t('field.invalidProfileId');
    if (code === 'invalidPreset') return t('provider.preset.invalid');
    if (code === 'invalidRealtimeModel') {
      return t('provider.aliyunRealtimeModelRequired');
    }
    if (code === 'invalidUrl') return t('field.invalidUrl');
    if (code === 'insecureUrl') return t('field.insecureUrl');
    if (code === 'tooLong') return t('field.tooLong');
    return t('field.required');
  };

  const submit = () => {
    const nextErrors = validateProviderForm(draft);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    void run(
      'save',
      async () => {
        await store.upsertProvider(toProviderInput(draft));
        onSaved();
      },
      { successMessage: t('provider.saved') },
    );
  };

  if (step === 'picker') {
    return (
      <>
        <DialogTitle id={titleId}>
          {t(
            draft.kind === 'text'
              ? 'provider.chooseTextProvider'
              : 'provider.chooseSpeechProvider',
          )}
        </DialogTitle>
        <DialogContent data-testid="provider-picker" dividers>
          <Stack sx={{ gap: 2.5 }}>
            <Typography color="text.secondary" variant="body2">
              {t('provider.choosePresetDescription')}
            </Typography>
            <Box
              aria-label={t('provider.choosePreset')}
              sx={{
                display: 'grid',
                gap: 1.5,
                gridTemplateColumns: {
                  xs: '1fr',
                  sm: 'repeat(2, minmax(0, 1fr))',
                },
              }}
            >
              {presets.map((preset) => (
                <ButtonBase
                  data-testid={`provider-preset-${preset.id}`}
                  key={preset.id}
                  onClick={() => {
                    const selected = selectProviderPreset(
                      draft,
                      preset,
                      existingIds,
                      false,
                    );
                    setDraft(
                      preset.id.startsWith('custom-')
                        ? { ...selected, name: t(preset.labelKey) }
                        : selected,
                    );
                    setErrors({});
                    setStep('details');
                  }}
                  sx={{
                    alignItems: 'center',
                    bgcolor: 'background.paper',
                    border: '1px solid',
                    borderColor: 'divider',
                    borderRadius: '12px',
                    gap: 1.5,
                    justifyContent: 'flex-start',
                    minHeight: 92,
                    p: 2,
                    textAlign: 'left',
                    transition: (currentTheme) =>
                      currentTheme.transitions.create([
                        'background-color',
                        'border-color',
                        'box-shadow',
                      ]),
                    width: '100%',
                    '&:hover': {
                      bgcolor: 'action.hover',
                      borderColor: 'text.secondary',
                    },
                    '&:focus-visible': {
                      boxShadow: (currentTheme) =>
                        `0 0 0 3px ${currentTheme.palette.action.focus}`,
                    },
                  }}
                >
                  <ProviderIcon icon={preset.icon} size={44} />
                  <Box sx={{ minWidth: 0 }}>
                    <Typography sx={{ fontSize: 14, fontWeight: 700 }}>
                      {t(preset.labelKey)}
                    </Typography>
                    <Typography
                      color="text.secondary"
                      sx={{
                        display: '-webkit-box',
                        overflow: 'hidden',
                        overflowWrap: 'anywhere',
                        WebkitBoxOrient: 'vertical',
                        WebkitLineClamp: 2,
                      }}
                      variant="caption"
                    >
                      {preset.baseUrl || t('provider.customEndpointHint')}
                    </Typography>
                  </Box>
                </ButtonBase>
              ))}
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button color="inherit" onClick={onClose} variant="text">
            {t('action.cancel')}
          </Button>
        </DialogActions>
      </>
    );
  }

  return (
    <>
      <DialogTitle id={titleId}>
        <Stack direction="row" sx={{ alignItems: 'center', gap: 1.25 }}>
          {editing ? null : (
            <IconButton
              aria-label={t('provider.backToPresets')}
              edge="start"
              onClick={() => {
                setErrors({});
                setStep('picker');
              }}
              size="small"
            >
              <ArrowBackRoundedIcon fontSize="small" />
            </IconButton>
          )}
          <Box sx={{ minWidth: 0 }}>
            <Typography component="span" sx={{ fontSize: 18, fontWeight: 700 }}>
              {editing ? t('provider.edit') : t('provider.configure')}
            </Typography>
            {selectedPreset ? (
              <Typography
                color="text.secondary"
                sx={{ display: 'block' }}
                variant="caption"
              >
                {t(selectedPreset.labelKey)}
              </Typography>
            ) : null}
          </Box>
        </Stack>
      </DialogTitle>
      <Box
        component="form"
        data-testid="provider-details"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        sx={{ display: 'flex', flex: 1, flexDirection: 'column', minHeight: 0 }}
      >
        <DialogContent dividers sx={{ flex: 1 }}>
          <Stack sx={{ gap: 3 }}>
            {isCustomText ? (
              <Field
                helperText={t('provider.endpointTypeHint')}
                label={t('provider.endpointType')}
                onChange={(event) =>
                  setDraft(
                    selectTextEndpointType(
                      draft,
                      event.target.value as
                        | 'anthropic-text'
                        | 'openai-compatible-text'
                        | 'openai-responses-text',
                    ),
                  )
                }
                select
                slotProps={{
                  htmlInput: { 'data-testid': 'provider-endpoint-type' },
                }}
                value={draft.providerId}
              >
                {TEXT_ENDPOINT_TYPES.map((option) => (
                  <MenuItem key={option.providerId} value={option.providerId}>
                    {t(option.labelKey)}
                  </MenuItem>
                ))}
              </Field>
            ) : null}

            {isAliyun ? (
              <Alert severity="info">
                <Typography variant="body2">
                  {t('provider.aliyunHint')}
                </Typography>
                <Typography color="text.secondary" variant="caption">
                  {t('provider.aliyunWorkspaceHint')}
                </Typography>
              </Alert>
            ) : null}

            <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ gap: 2 }}>
              <Field
                autoComplete="off"
                error={errors.name !== undefined}
                helperText={errorText(errors.name)}
                label={t('provider.name')}
                onChange={(event) =>
                  setDraft({ ...draft, name: event.target.value })
                }
                slotProps={{ htmlInput: { maxLength: 200 } }}
                value={draft.name}
              />
              <Field
                autoComplete="off"
                error={errors.model !== undefined}
                helperText={errorText(errors.model)}
                label={t('provider.model')}
                onChange={(event) =>
                  setDraft({ ...draft, model: event.target.value })
                }
                slotProps={{
                  htmlInput: {
                    'data-testid': 'provider-model-input',
                    maxLength: 200,
                  },
                }}
                value={draft.model}
              />
            </Stack>
            {isAliyun ? (
              <SwitchField
                checked={draft.realtimeSpeechEnabled}
                description={t('provider.aliyunRealtimeHint')}
                label={t('provider.aliyunRealtime')}
                onCheckedChange={(checked) =>
                  setDraft(setAliyunRealtimeSpeechEnabled(draft, checked))
                }
                testId="aliyun-realtime-speech-switch"
              />
            ) : null}
            <Field
              autoComplete="new-password"
              error={errors.apiKey !== undefined}
              helperText={
                errorText(errors.apiKey) ??
                (draft.hasStoredApiKey ? t('provider.apiKeyKeep') : undefined)
              }
              label={t('provider.apiKey')}
              onChange={(event) =>
                setDraft({ ...draft, apiKey: event.target.value })
              }
              type="password"
              value={draft.apiKey}
            />
            <Field
              autoComplete="off"
              error={errors.baseUrl !== undefined}
              helperText={
                errorText(errors.baseUrl) ??
                (isAliyun ? t('provider.aliyunWorkspaceHint') : undefined)
              }
              label={t('provider.baseUrl')}
              onChange={(event) =>
                setDraft({ ...draft, baseUrl: event.target.value })
              }
              placeholder="https://api.example.com/v1"
              value={draft.baseUrl}
            />
            <SwitchField
              checked={draft.allowInsecurePrivateEndpoint}
              description={t('provider.allowInsecureHint')}
              label={t('provider.allowInsecure')}
              onCheckedChange={(checked) =>
                setDraft({
                  ...draft,
                  allowInsecurePrivateEndpoint: checked,
                })
              }
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ gap: 1, px: 3, py: 2 }}>
          <Button color="inherit" onClick={onClose} variant="text">
            {t('action.cancel')}
          </Button>
          <Button
            disabled={isPending('save')}
            type="submit"
            variant="contained"
          >
            {t('action.save')}
          </Button>
        </DialogActions>
      </Box>
    </>
  );
};

export const ProviderDialog = ({
  editing,
  existingIds,
  form,
  onClose,
  onSaved,
  store,
}: ProviderDialogProps) => {
  const titleId = useId();

  return (
    <Dialog
      aria-labelledby={titleId}
      fullWidth
      maxWidth="md"
      onClose={onClose}
      open={form !== null}
      slotProps={{
        paper: {
          sx: {
            '@media (max-width: 600px)': {
              borderRadius: 0,
              height: '100%',
              margin: 0,
              maxHeight: '100%',
              width: '100%',
            },
          },
        },
      }}
    >
      {form ? (
        <ProviderDialogFlow
          editing={editing}
          existingIds={existingIds}
          initialForm={form}
          key={`${form.id}:${editing ? 'edit' : 'new'}`}
          onClose={onClose}
          onSaved={onSaved}
          store={store}
          titleId={titleId}
        />
      ) : null}
    </Dialog>
  );
};
