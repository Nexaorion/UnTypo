import Box from '@mui/material/Box';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import {
  DEFAULT_APPLICATION_WRITING_STYLES,
  WRITING_STYLE_PRESETS,
  type TargetApplicationKind,
  type WritingStylePreset,
} from '../../shared/personalization.js';
import { useI18n } from '../i18n/context.js';
import type { MessageKey } from '../i18n/messages.js';
import type { ClientStore } from '../state/client.js';
import { useAction } from '../state/use-action.js';
import { Field } from '../ui/field.js';
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

export const PersonalizationSection = ({ store }: { store: ClientStore }) => {
  const { t } = useI18n();
  const { isPending, run } = useAction();
  const learningEnabled = store.snapshot?.dictionaryLearning.enabled ?? false;
  const applicationStyles =
    store.snapshot?.personalization.applicationStyles ??
    DEFAULT_APPLICATION_WRITING_STYLES;
  const hasTextModel =
    store.snapshot?.settings.dictation.activeTextProviderProfileId !==
    undefined;
  const learningDescription = [
    t('dictionary.learningDescription'),
    ...(!hasTextModel ? [t('dictionary.learningUnavailable')] : []),
  ].join(' · ');

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
    </Page>
  );
};
