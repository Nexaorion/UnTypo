import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import KeyboardRoundedIcon from '@mui/icons-material/KeyboardRounded';
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';
import Box from '@mui/material/Box';
import Dialog from '@mui/material/Dialog';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';
import { useState, type ReactElement, type ReactNode } from 'react';
import { useI18n } from '../i18n/context.js';
import type { ClientStore } from '../state/client.js';
import { themeAlpha, themePalette } from '../theme.js';
import { DictionarySection } from './dictionary.js';
import { ProvidersSection } from './providers.js';
import { SettingsSection } from './settings.js';

type SettingsTab = 'settings' | 'models' | 'personalization';

const SettingsPanel = ({
  children,
  tab,
  value,
}: {
  children: ReactNode;
  tab: SettingsTab;
  value: SettingsTab;
}) => (
  <Box
    aria-labelledby={`settings-tab-${tab}`}
    id={`settings-panel-${tab}`}
    role="tabpanel"
    sx={{
      display: tab === value ? 'block' : 'none',
      minHeight: '100%',
      minWidth: 0,
    }}
  >
    {tab === value ? children : null}
  </Box>
);

const SettingsNavigation = ({
  onChange,
  value,
}: {
  onChange: (next: SettingsTab) => void;
  value: SettingsTab;
}) => {
  const { t } = useI18n();
  const tabs: readonly {
    icon: ReactElement;
    label: string;
    value: SettingsTab;
  }[] = [
    {
      icon: <KeyboardRoundedIcon fontSize="small" />,
      label: t('nav.settings'),
      value: 'settings',
    },
    {
      icon: <SmartToyOutlinedIcon fontSize="small" />,
      label: t('nav.providers'),
      value: 'models',
    },
    {
      icon: <AutoAwesomeRoundedIcon fontSize="small" />,
      label: t('nav.personalization'),
      value: 'personalization',
    },
  ];

  return (
    <Stack
      component="nav"
      sx={(currentTheme) => ({
        backgroundColor: '#f5f5f5',
        borderRight: '1px solid',
        borderRightColor: 'divider',
        flexShrink: 0,
        gap: 4.5,
        minHeight: 0,
        p: { xs: 2.5, sm: 3 },
        width: { xs: 196, sm: 224, md: 248 },
        ...currentTheme.applyStyles('dark', {
          backgroundColor: '#1a1a1a',
        }),
      })}
    >
      <Stack
        direction="row"
        sx={{ alignItems: 'center', minHeight: 38, px: 0.75 }}
      >
        <Typography
          sx={{ fontSize: 18, fontWeight: 760, letterSpacing: '-0.025em' }}
        >
          UnTypo
        </Typography>
      </Stack>

      <Tabs
        aria-label={t('nav.sections')}
        onChange={(_event, next: SettingsTab) => onChange(next)}
        orientation="vertical"
        slotProps={{ indicator: { sx: { display: 'none' } } }}
        sx={{
          '& .MuiTabs-flexContainer': { gap: 0.75 },
          '& .MuiTab-icon': { mr: 1.5 },
        }}
        value={value}
      >
        {tabs.map((tab) => (
          <Tab
            aria-controls={`settings-panel-${tab.value}`}
            icon={tab.icon}
            iconPosition="start"
            id={`settings-tab-${tab.value}`}
            key={tab.value}
            label={tab.label}
            sx={(currentTheme) => ({
              color: 'text.secondary',
              justifyContent: 'flex-start',
              position: 'relative',
              transition: currentTheme.transitions.create(
                ['background-color', 'color'],
                { duration: currentTheme.transitions.duration.shorter },
              ),
              '&:hover': {
                backgroundColor: 'action.hover',
                color: 'text.primary',
              },
              '&.Mui-selected': {
                backgroundColor: themeAlpha(
                  themePalette(currentTheme).primary.main,
                  0.1,
                ),
                color: 'primary.main',
              },
            })}
            value={tab.value}
          />
        ))}
      </Tabs>
    </Stack>
  );
};

export const SettingsDialog = ({
  onOpenChange,
  open,
  store,
}: {
  onOpenChange: (open: boolean) => void;
  open: boolean;
  store: ClientStore;
}) => {
  const { t } = useI18n();
  const [tab, setTab] = useState<SettingsTab>('settings');

  return (
    <Dialog
      aria-label={t('settings.title')}
      data-testid="settings-dialog"
      fullWidth
      maxWidth={false}
      onClose={() => onOpenChange(false)}
      open={open}
      slotProps={{
        backdrop: {
          sx: (currentTheme) => ({
            backgroundColor: themeAlpha('#000000', 0.22),
            ...currentTheme.applyStyles('dark', {
              backgroundColor: themeAlpha('#000000', 0.58),
            }),
          }),
        },
        paper: {
          sx: {
            height: 'calc(100% - 32px)',
            maxHeight: 1000,
            maxWidth: 1580,
            overflow: 'hidden',
            width: 'calc(100% - 32px)',
          },
        },
      }}
    >
      <Stack direction="row" sx={{ height: '100%', minHeight: 0 }}>
        <SettingsNavigation onChange={setTab} value={tab} />
        <Box
          component="main"
          sx={{
            bgcolor: 'background.default',
            flex: 1,
            minWidth: 0,
            overflowY: 'auto',
            position: 'relative',
          }}
        >
          <IconButton
            aria-label={t('action.close')}
            data-testid="settings-close"
            onClick={() => onOpenChange(false)}
            sx={{ position: 'absolute', right: 24, top: 24, zIndex: 1 }}
          >
            <CloseRoundedIcon />
          </IconButton>
          <SettingsPanel tab="settings" value={tab}>
            <SettingsSection store={store} />
          </SettingsPanel>
          <SettingsPanel tab="models" value={tab}>
            <ProvidersSection store={store} />
          </SettingsPanel>
          <SettingsPanel tab="personalization" value={tab}>
            <DictionarySection store={store} />
          </SettingsPanel>
        </Box>
      </Stack>
    </Dialog>
  );
};
