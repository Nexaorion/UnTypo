import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Stack from '@mui/material/Stack';
import { useEffect, useId, useState } from 'react';
import { useI18n } from '../i18n/context.js';
import {
  toProviderInput,
  validateProviderForm,
  type ProviderFormErrorCode,
  type ProviderFormErrors,
  type ProviderFormState,
} from '../logic/provider-form.js';
import type { ClientStore } from '../state/client.js';
import { useAction } from '../state/use-action.js';
import { Field } from '../ui/field.js';
import { SwitchField } from '../ui/switch-field.js';

interface ProviderDialogProps {
  editing: boolean;
  form: ProviderFormState | null;
  onClose: () => void;
  onSaved: () => void;
  store: ClientStore;
}

export const ProviderDialog = ({
  editing,
  form,
  onClose,
  onSaved,
  store,
}: ProviderDialogProps) => {
  const { t } = useI18n();
  const { isPending, run } = useAction();
  const titleId = useId();
  const [draft, setDraft] = useState<ProviderFormState | null>(form);
  const [errors, setErrors] = useState<ProviderFormErrors>({});

  useEffect(() => {
    setDraft(form);
    setErrors({});
  }, [form]);

  const errorText = (code?: ProviderFormErrorCode): string | undefined => {
    if (!code) return undefined;
    if (code === 'invalidId') return t('field.invalidProfileId');
    if (code === 'invalidUrl') return t('field.invalidUrl');
    if (code === 'insecureUrl') return t('field.insecureUrl');
    if (code === 'tooLong') return t('field.tooLong');
    return t('field.required');
  };

  const submit = () => {
    if (!draft) return;
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

  return (
    <Dialog
      aria-labelledby={titleId}
      fullWidth
      maxWidth="sm"
      onClose={onClose}
      open={form !== null}
    >
      <DialogTitle id={titleId}>
        {editing ? t('provider.edit') : t('provider.add')}
      </DialogTitle>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <DialogContent dividers>
          {draft ? (
            <Stack sx={{ gap: 2.5 }}>
              <Field
                autoComplete="off"
                disabled={editing}
                error={errors.id !== undefined}
                helperText={
                  errorText(errors.id) ??
                  (editing ? t('provider.idLocked') : undefined)
                }
                label={t('provider.id')}
                onChange={(event) =>
                  setDraft({ ...draft, id: event.target.value })
                }
                placeholder="openai-main"
                value={draft.id}
              />
              <Field
                autoComplete="off"
                error={errors.apiKey !== undefined}
                helperText={
                  errorText(errors.apiKey) ??
                  (editing ? t('provider.apiKeyReenter') : undefined)
                }
                label={t('provider.apiKey')}
                onChange={(event) =>
                  setDraft({ ...draft, apiKey: event.target.value })
                }
                type="password"
                value={draft.apiKey}
              />
              <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ gap: 2 }}>
                <Field
                  autoComplete="off"
                  error={errors.textModel !== undefined}
                  fullWidth
                  helperText={errorText(errors.textModel)}
                  label={t('provider.textModel')}
                  onChange={(event) =>
                    setDraft({ ...draft, textModel: event.target.value })
                  }
                  value={draft.textModel}
                />
                <Field
                  autoComplete="off"
                  error={errors.transcriptionModel !== undefined}
                  fullWidth
                  helperText={errorText(errors.transcriptionModel)}
                  label={t('provider.transcriptionModel')}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      transcriptionModel: event.target.value,
                    })
                  }
                  value={draft.transcriptionModel}
                />
              </Stack>
              <Field
                autoComplete="off"
                error={errors.baseUrl !== undefined}
                helperText={errorText(errors.baseUrl)}
                label={t('provider.baseUrl')}
                onChange={(event) =>
                  setDraft({ ...draft, baseUrl: event.target.value })
                }
                placeholder="https://api.openai.com/v1"
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
          ) : null}
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
      </form>
    </Dialog>
  );
};
