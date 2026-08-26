import BugReportOutlinedIcon from '@mui/icons-material/BugReportOutlined';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import Button from '@mui/material/Button';
import FormLabel from '@mui/material/FormLabel';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SupportedLanguage } from '../../core/providers/contracts.js';
import type { ClientMicrophoneDevice } from '../../shared/ipc.js';
import { useI18n } from '../i18n/context.js';
import {
  formatHotkeyAccelerator,
  isValidHotkeyAccelerator,
} from '../logic/hotkey.js';
import { describeError, type ClientStore } from '../state/client.js';
import { useAction } from '../state/use-action.js';
import { Field } from '../ui/field.js';
import { HotkeyField } from '../ui/hotkey-field.js';
import { Card, Page, PageHeader } from '../ui/page.js';
import { SwitchField } from '../ui/switch-field.js';

const RETENTION_MAX = 3_650;

const LANGUAGES: readonly { label: string; value: SupportedLanguage }[] = [
  { label: '简体中文', value: 'zh-CN' },
  { label: 'English', value: 'en-US' },
];

export const SettingsSection = ({
  onOpenDiagnostics,
  store,
}: {
  onOpenDiagnostics: () => void;
  store: ClientStore;
}) => {
  const { t } = useI18n();
  const { isPending, run } = useAction();
  const settings = store.snapshot?.settings;
  const profile = store.snapshot?.profile;
  const listMicrophones = store.listMicrophones;
  const pendingDiagnosticCount =
    store.diagnostics?.issues.filter(
      ({ acknowledgedAt }) => acknowledgedAt === undefined,
    ).length ?? 0;

  const [hotkey, setHotkey] = useState('');
  const [hotkeyError, setHotkeyError] = useState<string | undefined>(undefined);
  const [microphones, setMicrophones] = useState<
    readonly ClientMicrophoneDevice[]
  >([]);
  const [microphoneError, setMicrophoneError] = useState<string>();
  const [microphonesLoading, setMicrophonesLoading] = useState(false);
  const microphoneRequest = useRef(0);
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

  const refreshMicrophones = useCallback(async () => {
    const request = microphoneRequest.current + 1;
    microphoneRequest.current = request;
    setMicrophonesLoading(true);
    setMicrophoneError(undefined);
    try {
      const devices = await listMicrophones();
      if (microphoneRequest.current === request) setMicrophones(devices);
    } catch (error) {
      if (microphoneRequest.current === request) {
        setMicrophoneError(
          describeError(error) ?? t('settings.microphoneUnavailable'),
        );
      }
    } finally {
      if (microphoneRequest.current === request) setMicrophonesLoading(false);
    }
  }, [listMicrophones, t]);

  useEffect(() => {
    void refreshMicrophones();
    return () => {
      microphoneRequest.current += 1;
    };
  }, [refreshMicrophones]);

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
    if (normalized === settings.dictation.hotkeyAccelerator) return;
    const failureMessage = (error: unknown) =>
      error instanceof Error && error.message.includes('HOTKEY_CONFLICT')
        ? t('field.hotkeyConflict')
        : t('field.hotkeyUnavailable');
    void run(
      'hotkey',
      () =>
        store.updateSettings({ dictation: { hotkeyAccelerator: normalized } }),
      {
        describeError: failureMessage,
        onError: (error) => {
          setHotkey(settings.dictation.hotkeyAccelerator);
          setHotkeyError(failureMessage(error));
        },
      },
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

  const microphoneDeviceId = settings.dictation.microphoneDeviceId ?? '';
  const microphoneDeviceLabel = settings.dictation.microphoneDeviceLabel;

  let selectedMicrophone = microphones.find(
    ({ deviceId }) => deviceId === microphoneDeviceId,
  );

  if (!selectedMicrophone && microphoneDeviceId && microphoneDeviceLabel) {
    selectedMicrophone = microphones.find(
      ({ label }) => label === microphoneDeviceLabel,
    );
    if (selectedMicrophone) {
      void run('microphone', () =>
        store.updateSettings({
          dictation: {
            microphoneDeviceId: selectedMicrophone.deviceId,
            microphoneDeviceLabel: selectedMicrophone.label,
          },
        }),
      );
    }
  }

  const selectedMicrophoneMissing =
    microphoneDeviceId.length > 0 &&
    !microphonesLoading &&
    !microphoneError &&
    !selectedMicrophone;
  const microphoneHelperText = microphoneError
    ? microphoneError
    : selectedMicrophoneMissing
      ? t('settings.microphoneMissing')
      : selectedMicrophone
        ? t('settings.microphoneSelectedHint', {
            device: selectedMicrophone.label,
          })
        : microphones.length === 0 && !microphonesLoading
          ? t('settings.microphoneEmpty')
          : t('settings.microphoneAutoHint');

  return (
    <Page>
      <PageHeader title={t('settings.title')} />

      <Card title={t('settings.group.dictation')}>
        <Stack sx={{ gap: 2.5 }}>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            sx={{ alignItems: { sm: 'flex-start' }, gap: 1.25 }}
          >
            <Field
              data-testid="microphone-select"
              disabled={isPending('microphone')}
              error={Boolean(microphoneError || selectedMicrophoneMissing)}
              helperText={microphoneHelperText}
              label={t('settings.microphone')}
              onChange={(event) => {
                const next = event.target.value;
                const selectedDevice = microphones.find(
                  ({ deviceId }) => deviceId === next,
                );
                void run('microphone', () =>
                  store.updateSettings({
                    dictation: {
                      microphoneDeviceId: next.length > 0 ? next : null,
                      microphoneDeviceLabel:
                        next.length > 0 && selectedDevice
                          ? selectedDevice.label
                          : null,
                    },
                  }),
                );
              }}
              select
              value={microphoneDeviceId}
            >
              <MenuItem value="">{t('settings.microphoneAuto')}</MenuItem>
              {selectedMicrophoneMissing ? (
                <MenuItem value={microphoneDeviceId}>
                  {t('settings.microphoneMissing')}
                </MenuItem>
              ) : null}
              {microphones
                .filter(({ deviceId }) => deviceId !== 'default')
                .map((device) => (
                  <MenuItem key={device.deviceId} value={device.deviceId}>
                    {device.label}
                  </MenuItem>
                ))}
            </Field>
            <Stack
              sx={{
                flex: '0 0 auto',
                gap: 0.75,
                width: { xs: '100%', sm: 'auto' },
              }}
            >
              <FormLabel
                aria-hidden="true"
                sx={{
                  display: { xs: 'none', sm: 'block' },
                  visibility: 'hidden',
                }}
              >
                {t('settings.microphone')}
              </FormLabel>
              <Button
                data-testid="microphone-refresh"
                disabled={microphonesLoading}
                onClick={() => void refreshMicrophones()}
                startIcon={<RefreshRoundedIcon />}
                sx={{ height: 44, minHeight: 44, px: 2.25 }}
                variant="outlined"
              >
                {t('action.refresh')}
              </Button>
            </Stack>
          </Stack>
          <HotkeyField
            error={hotkeyError}
            label={t('settings.hotkey')}
            listeningText={t('settings.hotkeyHint')}
            onChange={saveHotkey}
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
            data-testid="diagnostics-open"
            onClick={onOpenDiagnostics}
            startIcon={<BugReportOutlinedIcon />}
            variant="outlined"
          >
            {t('settings.diagnosticsOpen')}
          </Button>
        }
        title={t('settings.group.diagnostics')}
      >
        <Stack sx={{ gap: 0.75 }}>
          <Typography variant="body2">
            {t('settings.diagnosticsDescription')}
          </Typography>
          <Typography color="text.secondary" variant="caption">
            {pendingDiagnosticCount > 0
              ? t('settings.diagnosticsPending', {
                  count: String(pendingDiagnosticCount),
                })
              : t('settings.diagnosticsReady')}
          </Typography>
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
