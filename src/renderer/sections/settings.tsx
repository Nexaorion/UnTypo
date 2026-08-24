import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import { useEffect, useState } from 'react';
import type { SupportedLanguage } from '../../core/providers/contracts.js';
import { useI18n } from '../i18n/context.js';
import {
  acceleratorFromEvent,
  formatHotkeyAccelerator,
  isValidHotkeyAccelerator,
} from '../logic/hotkey.js';
import type { ClientStore } from '../state/client.js';
import { useAction } from '../state/use-action.js';
import { Field } from '../ui/field.js';
import { Card, Page, PageHeader } from '../ui/page.js';
import { SwitchField } from '../ui/switch-field.js';

const RETENTION_MAX = 3_650;

const LANGUAGES: readonly { label: string; value: SupportedLanguage }[] = [
  { label: '简体中文', value: 'zh-CN' },
  { label: 'English', value: 'en-US' },
];

export const SettingsSection = ({ store }: { store: ClientStore }) => {
  const { t } = useI18n();
  const { isPending, run } = useAction();
  const settings = store.snapshot?.settings;
  const profile = store.snapshot?.profile;

  const [hotkey, setHotkey] = useState('');
  const [hotkeyError, setHotkeyError] = useState<string | undefined>(undefined);
  const [retention, setRetention] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [preferredName, setPreferredName] = useState('');
  const [signature, setSignature] = useState('');

  useEffect(() => {
    if (settings) {
      setHotkey(settings.dictation.hotkeyAccelerator);
      setRetention(String(settings.history.retentionDays));
    }
  }, [settings?.dictation.hotkeyAccelerator, settings?.history.retentionDays]);

  useEffect(() => {
    setDisplayName(profile?.displayName ?? '');
    setPreferredName(profile?.preferredName ?? '');
    setSignature(profile?.signature ?? '');
  }, [profile?.displayName, profile?.preferredName, profile?.signature]);

  if (!settings) {
    return (
      <Page>
        <PageHeader title={t('settings.title')} />
      </Page>
    );
  }

  const saveHotkey = (value: string) => {
    const normalized = formatHotkeyAccelerator(value);
    if (!isValidHotkeyAccelerator(normalized)) {
      setHotkeyError(t('field.invalidHotkey'));
      return;
    }
    setHotkeyError(undefined);
    setHotkey(normalized);
    void run('hotkey', () =>
      store.updateSettings({ dictation: { hotkeyAccelerator: normalized } }),
    );
  };

  const saveRetention = () => {
    const parsed = Number(retention);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > RETENTION_MAX) {
      setRetention(String(settings.history.retentionDays));
      return;
    }
    if (parsed === settings.history.retentionDays) return;
    void run('retention', () =>
      store.updateSettings({ history: { retentionDays: parsed } }),
    );
  };

  const saveProfile = () => {
    const next = {
      ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
      ...(preferredName.trim() ? { preferredName: preferredName.trim() } : {}),
      ...(signature.trim() ? { signature: signature.trim() } : {}),
    };
    void run(
      'profile',
      () => store.setProfile(Object.keys(next).length > 0 ? next : undefined),
      { successMessage: t('provider.saved') },
    );
  };

  const languageSelect = (
    label: string,
    value: SupportedLanguage,
    onPick: (next: SupportedLanguage) => void,
  ) => (
    <Field
      label={label}
      onChange={(event) => onPick(event.target.value as SupportedLanguage)}
      select
      value={value}
    >
      {LANGUAGES.map((language) => (
        <MenuItem key={language.value} value={language.value}>
          {language.label}
        </MenuItem>
      ))}
    </Field>
  );

  return (
    <Page>
      <PageHeader title={t('settings.title')} />

      <Card title={t('settings.group.dictation')}>
        <Stack sx={{ gap: 2.5 }}>
          <Field
            label={t('settings.hotkeyMode')}
            onChange={(event) =>
              void run('hotkeyMode', () =>
                store.updateSettings({
                  dictation: {
                    hotkeyMode:
                      event.target.value === 'toggle'
                        ? 'toggle'
                        : 'push-to-talk',
                  },
                }),
              )
            }
            select
            value={settings.dictation.hotkeyMode}
          >
            <MenuItem value="push-to-talk">
              {t('settings.hotkeyMode.pushToTalk')}
            </MenuItem>
            <MenuItem value="toggle">
              {t('settings.hotkeyMode.toggle')}
            </MenuItem>
          </Field>
          <Field
            autoComplete="off"
            error={hotkeyError !== undefined}
            helperText={hotkeyError}
            label={t('settings.hotkey')}
            onBlur={() => saveHotkey(hotkey)}
            onChange={(event) => setHotkey(event.target.value)}
            onKeyDown={(event) => {
              const captured = acceleratorFromEvent(event);
              if (!captured) return;
              event.preventDefault();
              saveHotkey(captured);
            }}
            value={hotkey}
          />
          {languageSelect(
            t('settings.dictationLanguage'),
            settings.dictation.language,
            (next) =>
              void run('dictationLanguage', () =>
                store.updateSettings({ dictation: { language: next } }),
              ),
          )}
          {languageSelect(
            t('settings.defaultTargetLanguage'),
            settings.dictation.defaultTargetLanguage,
            (next) =>
              void run('targetLanguage', () =>
                store.updateSettings({
                  dictation: { defaultTargetLanguage: next },
                }),
              ),
          )}
        </Stack>
      </Card>

      <Card title={t('settings.group.general')}>
        <Stack sx={{ gap: 2.5 }}>
          {languageSelect(
            t('settings.locale'),
            settings.general.locale,
            (next) =>
              void run('locale', () =>
                store.updateSettings({ general: { locale: next } }),
              ),
          )}
          <SwitchField
            checked={settings.general.launchAtLogin}
            label={t('settings.launchAtLogin')}
            onCheckedChange={(checked) =>
              void run('launchAtLogin', () =>
                store.updateSettings({ general: { launchAtLogin: checked } }),
              )
            }
          />
        </Stack>
      </Card>

      <Card title={t('settings.group.history')}>
        <Stack sx={{ gap: 2.5 }}>
          <SwitchField
            checked={settings.history.enabled}
            label={t('settings.historyEnabled')}
            onCheckedChange={(checked) =>
              void run('historyEnabled', () =>
                store.updateSettings({ history: { enabled: checked } }),
              )
            }
          />
          <Field
            helperText={t('settings.retentionForever')}
            label={t('settings.retentionDays')}
            onBlur={saveRetention}
            onChange={(event) => setRetention(event.target.value)}
            slotProps={{
              htmlInput: { inputMode: 'numeric', max: RETENTION_MAX, min: 0 },
            }}
            type="number"
            value={retention}
          />
        </Stack>
      </Card>

      <Card
        actions={
          <Button
            disabled={isPending('profile')}
            onClick={saveProfile}
            variant="contained"
          >
            {t('action.save')}
          </Button>
        }
        title={t('settings.group.profile')}
      >
        <Stack sx={{ gap: 2.5 }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ gap: 2 }}>
            <Field
              autoComplete="off"
              fullWidth
              label={t('settings.profile.displayName')}
              onChange={(event) => setDisplayName(event.target.value)}
              slotProps={{ htmlInput: { maxLength: 200 } }}
              value={displayName}
            />
            <Field
              autoComplete="off"
              fullWidth
              label={t('settings.profile.preferredName')}
              onChange={(event) => setPreferredName(event.target.value)}
              slotProps={{ htmlInput: { maxLength: 200 } }}
              value={preferredName}
            />
          </Stack>
          <Field
            label={t('settings.profile.signature')}
            minRows={3}
            multiline
            onChange={(event) => setSignature(event.target.value)}
            slotProps={{ htmlInput: { maxLength: 1_000 } }}
            value={signature}
          />
        </Stack>
      </Card>
    </Page>
  );
};
