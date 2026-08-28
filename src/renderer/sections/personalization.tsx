import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import {
  DEFAULT_APPLICATION_WRITING_STYLES,
  WRITING_STYLE_PRESETS,
  type TargetApplicationKind,
  type WritingPreferenceKind,
  type WritingStylePreset,
} from '../../shared/personalization.js';
import { useI18n, type Translate } from '../i18n/context.js';
import type { MessageKey } from '../i18n/messages.js';
import type { ClientStore } from '../state/client.js';
import { useAction } from '../state/use-action.js';
import { Field } from '../ui/field.js';
import { ConfirmDialog } from '../ui/confirm-dialog.js';
import { Card, Page, PageHeader } from '../ui/page.js';
import { SwitchField } from '../ui/switch-field.js';

const applicationOrder: readonly TargetApplicationKind[] = [
  'chat-app',
  'ai-tool',
  'office',
  'ide',
  'browser',
  'general',
];

const applicationLabels: Readonly<Record<TargetApplicationKind, MessageKey>> = {
  'ai-tool': 'personalization.application.aiTool',
  browser: 'personalization.application.browser',
  'chat-app': 'personalization.application.chatApp',
  general: 'personalization.application.general',
  ide: 'personalization.application.ide',
  office: 'personalization.application.office',
};

const styleLabels: Readonly<Record<WritingStylePreset, MessageKey>> = {
  auto: 'personalization.style.auto',
  casual: 'personalization.style.casual',
  concise: 'personalization.style.concise',
  formal: 'personalization.style.formal',
  prompt: 'personalization.style.prompt',
};

const styleDescriptions: Readonly<Record<WritingStylePreset, MessageKey>> = {
  auto: 'personalization.style.autoDescription',
  casual: 'personalization.style.casualDescription',
  concise: 'personalization.style.conciseDescription',
  formal: 'personalization.style.formalDescription',
  prompt: 'personalization.style.promptDescription',
};

const preferenceDescription = (
  t: Translate,
  kind: WritingPreferenceKind,
  value: string,
): string => {
  if (kind === 'expression') {
    return t('personalization.memory.expression', { value });
  }
  const key = `personalization.memory.${kind}.${value}`;
  const keys: readonly MessageKey[] = [
    'personalization.memory.emoji.allow',
    'personalization.memory.emoji.avoid',
    'personalization.memory.punctuation.minimal',
    'personalization.memory.punctuation.standard',
    'personalization.memory.structure.lists',
    'personalization.memory.structure.paragraphs',
    'personalization.memory.tone.casual',
    'personalization.memory.tone.formal',
    'personalization.memory.tone.polite',
    'personalization.memory.verbosity.concise',
    'personalization.memory.verbosity.detailed',
  ];
  const messageKey = keys.find((candidate) => candidate === key);
  return messageKey ? t(messageKey) : value;
};

export const PersonalizationSection = ({ store }: { store: ClientStore }) => {
  const { t } = useI18n();
  const { isPending, run } = useAction();
  const [clearMemoryOpen, setClearMemoryOpen] = useState(false);
  const learningEnabled = store.snapshot?.dictionaryLearning.enabled ?? false;
  const applicationStyles =
    store.snapshot?.personalization.applicationStyles ??
    DEFAULT_APPLICATION_WRITING_STYLES;
  const personalizationLearningEnabled =
    store.snapshot?.personalization.learningEnabled ?? false;
  const preferences = store.snapshot?.personalization.preferences ?? [];
  const suggestions = store.snapshot?.personalization.suggestions ?? [];
  const hasTextModel =
    store.snapshot?.settings.dictation.activeTextProviderProfileId !==
    undefined;
  const learningDescription = [
    t('dictionary.learningDescription'),
    ...(!hasTextModel ? [t('dictionary.learningUnavailable')] : []),
  ].join(' · ');
  const personalizationLearningDescription = [
    t('personalization.learningDescription'),
    ...(!hasTextModel ? [t('personalization.learningUnavailable')] : []),
  ].join(' · ');
  const hasMemory = preferences.length > 0 || suggestions.length > 0;

  return (
    <Page>
      <PageHeader title={t('nav.personalization')} />

      <Card title={t('personalization.applicationStyles')}>
        <Stack sx={{ gap: 2.5 }}>
          <Typography color="text.secondary" variant="body2">
            {t('personalization.applicationStylesDescription')}
          </Typography>
          <Box
            sx={{
              display: 'grid',
              gap: 2,
              gridTemplateColumns: {
                xs: '1fr',
                sm: 'repeat(2, minmax(0, 1fr))',
              },
            }}
          >
            {applicationOrder.map((application) => {
              const style = applicationStyles[application];
              return (
                <Field
                  data-testid={`writing-style-${application}`}
                  disabled={isPending(`writing-style-${application}`)}
                  helperText={t(styleDescriptions[style])}
                  key={application}
                  label={t(applicationLabels[application])}
                  onChange={(event) => {
                    const next = WRITING_STYLE_PRESETS.find(
                      (candidate) => candidate === event.target.value,
                    );
                    if (!next || next === style) return;
                    void run(`writing-style-${application}`, () =>
                      store.setApplicationWritingStyle({
                        application,
                        style: next,
                      }),
                    );
                  }}
                  select
                  value={style}
                >
                  {WRITING_STYLE_PRESETS.map((preset) => (
                    <MenuItem key={preset} value={preset}>
                      {t(styleLabels[preset])}
                    </MenuItem>
                  ))}
                </Field>
              );
            })}
          </Box>
        </Stack>
      </Card>

      <Card
        actions={
          hasMemory ? (
            <Button
              color="error"
              onClick={() => setClearMemoryOpen(true)}
              variant="text"
            >
              {t('personalization.clearMemory')}
            </Button>
          ) : undefined
        }
        title={t('personalization.learningTitle')}
      >
        <Stack sx={{ gap: 2.5 }}>
          <SwitchField
            checked={personalizationLearningEnabled}
            description={personalizationLearningDescription}
            disabled={isPending('personalization-learning')}
            label={t('personalization.learning')}
            onCheckedChange={(checked) =>
              void run('personalization-learning', () =>
                store.setPersonalizationLearningEnabled(checked),
              )
            }
            testId="personalization-learning-switch"
          />

          <Stack sx={{ gap: 1.25 }}>
            <Typography component="h3" variant="subtitle1">
              {t('personalization.suggestions')}
            </Typography>
            {suggestions.length > 0 ? (
              suggestions.map((suggestion) => (
                <Stack
                  data-testid={`personalization-suggestion-${suggestion.id}`}
                  direction={{ xs: 'column', sm: 'row' }}
                  key={suggestion.id}
                  sx={{
                    alignItems: { sm: 'center' },
                    borderTop: '1px solid',
                    borderTopColor: 'divider',
                    gap: 1.5,
                    justifyContent: 'space-between',
                    minWidth: 0,
                    pt: 1.5,
                  }}
                >
                  <Stack sx={{ gap: 0.25, minWidth: 0 }}>
                    <Typography
                      sx={{ overflowWrap: 'anywhere' }}
                      variant="body2"
                    >
                      {preferenceDescription(
                        t,
                        suggestion.kind,
                        suggestion.value,
                      )}
                    </Typography>
                    <Typography color="text.secondary" variant="caption">
                      {t('personalization.suggestionMeta', {
                        application: t(
                          applicationLabels[suggestion.application],
                        ),
                        count: String(suggestion.occurrences),
                      })}
                    </Typography>
                  </Stack>
                  <Stack direction="row" sx={{ flexShrink: 0, gap: 1 }}>
                    <Button
                      disabled={isPending(`reject-memory-${suggestion.id}`)}
                      onClick={() =>
                        void run(`reject-memory-${suggestion.id}`, () =>
                          store.rejectWritingPreference(suggestion.id),
                        )
                      }
                      variant="text"
                    >
                      {t('personalization.ignoreSuggestion')}
                    </Button>
                    <Button
                      disabled={isPending(`accept-memory-${suggestion.id}`)}
                      onClick={() =>
                        void run(`accept-memory-${suggestion.id}`, () =>
                          store.acceptWritingPreference(suggestion.id),
                        )
                      }
                      variant="outlined"
                    >
                      {t('personalization.keepSuggestion')}
                    </Button>
                  </Stack>
                </Stack>
              ))
            ) : (
              <Typography color="text.secondary" variant="body2">
                {t('personalization.noSuggestions')}
              </Typography>
            )}
          </Stack>

          <Stack sx={{ gap: 1.25 }}>
            <Typography component="h3" variant="subtitle1">
              {t('personalization.learnedPreferences')}
            </Typography>
            {preferences.length > 0 ? (
              preferences.map((preference) => (
                <Stack
                  direction={{ xs: 'column', sm: 'row' }}
                  key={preference.id}
                  sx={{
                    alignItems: { sm: 'center' },
                    borderTop: '1px solid',
                    borderTopColor: 'divider',
                    gap: 1.5,
                    justifyContent: 'space-between',
                    minWidth: 0,
                    pt: 1.5,
                  }}
                >
                  <Stack sx={{ gap: 0.25, minWidth: 0 }}>
                    <Typography
                      sx={{ overflowWrap: 'anywhere' }}
                      variant="body2"
                    >
                      {preferenceDescription(
                        t,
                        preference.kind,
                        preference.value,
                      )}
                    </Typography>
                    <Typography color="text.secondary" variant="caption">
                      {t(applicationLabels[preference.application])}
                    </Typography>
                  </Stack>
                  <Button
                    color="error"
                    disabled={isPending(`remove-memory-${preference.id}`)}
                    onClick={() =>
                      void run(`remove-memory-${preference.id}`, () =>
                        store.removeWritingPreference(preference.id),
                      )
                    }
                    sx={{ alignSelf: { xs: 'flex-start', sm: 'center' } }}
                    variant="text"
                  >
                    {t('action.remove')}
                  </Button>
                </Stack>
              ))
            ) : (
              <Typography color="text.secondary" variant="body2">
                {t('personalization.noLearnedPreferences')}
              </Typography>
            )}
          </Stack>
        </Stack>
      </Card>

      <Card title={t('dictionary.title')}>
        <Stack sx={{ gap: 2.5 }}>
          <SwitchField
            checked={learningEnabled}
            description={learningDescription}
            disabled={isPending('learning')}
            label={t('dictionary.learning')}
            onCheckedChange={(checked) =>
              void run('learning', () =>
                store.setDictionaryLearningEnabled(checked),
              )
            }
            testId="dictionary-learning-switch"
          />
        </Stack>
      </Card>

      <ConfirmDialog
        cancelLabel={t('action.cancel')}
        confirmLabel={t('action.clear')}
        description={t('personalization.clearMemoryDescription')}
        onConfirm={() =>
          void run('clear-personalization-memory', () =>
            store.clearPersonalizationMemory(),
          ).then((succeeded) => {
            if (succeeded) setClearMemoryOpen(false);
          })
        }
        onOpenChange={setClearMemoryOpen}
        open={clearMemoryOpen}
        pending={isPending('clear-personalization-memory')}
        title={t('personalization.clearMemoryConfirm')}
      />
    </Page>
  );
};
