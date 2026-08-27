import Stack from '@mui/material/Stack';
import { useI18n } from '../i18n/context.js';
import type { ClientStore } from '../state/client.js';
import { useAction } from '../state/use-action.js';
import { Card, Page, PageHeader } from '../ui/page.js';
import { SwitchField } from '../ui/switch-field.js';

export const PersonalizationSection = ({ store }: { store: ClientStore }) => {
  const { t } = useI18n();
  const { isPending, run } = useAction();
  const learningEnabled = store.snapshot?.dictionaryLearning.enabled ?? false;
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
