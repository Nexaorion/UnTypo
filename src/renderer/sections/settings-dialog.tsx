import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import KeyboardRoundedIcon from '@mui/icons-material/KeyboardRounded';
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';
import Box from '@mui/material/Box';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';
import { useId, type ReactElement, type ReactNode } from 'react';
import { useI18n } from '../i18n/context.js';
import type { ClientStore } from '../state/client.js';
import { themeAlpha, themePalette } from '../theme.js';
import { DictionarySection } from './dictionary.js';
import { ProvidersSection } from './providers.js';
import { SettingsSection } from './settings.js';

export type SettingsTab = 'settings' | 'models' | 'personalization';

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
        minHeight: 0,
        p: { xs: 1, sm: 3 },
        width: { xs: 72, sm: 224, md: 248 },
        ...currentTheme.applyStyles('dark', {
          backgroundColor: '#1a1a1a',
        }),
      })}
    >
      <Tabs
        aria-label={t('nav.sections')}
        onChange={(_event, next: SettingsTab) => onChange(next)}
        orientation="vertical"
        slotProps={{ indicator: { sx: { display: 'none' } } }}
        sx={{
          '& .MuiTabs-flexContainer': { gap: 0.75 },
        }}
        value={value}
      >
        {tabs.map((tab) => (
          <Tab
            aria-controls={`settings-panel-${tab.value}`}
            aria-label={tab.label}
            id={`settings-tab-${tab.value}`}
            key={tab.value}
            label={
              <Stack
                component="span"
                direction="row"
                sx={{
                  alignItems: 'center',
                  gap: { xs: 0, sm: 1.5 },
                  justifyContent: { xs: 'center', sm: 'flex-start' },
                  width: '100%',
                }}
              >
                <Box
                  component="span"
                  sx={{
                    alignItems: 'center',
                    display: 'inline-flex',
                    flex: '0 0 24px',
                    height: 24,
                    justifyContent: 'center',
                    width: 24,
                    '& svg': { fontSize: 20 },
                  }}
                >
                  {tab.icon}
                </Box>
                <Box
                  component="span"
                  sx={{
                    display: { xs: 'none', sm: 'inline' },
                    lineHeight: '24px',
                  }}
                >
                  {tab.label}
                </Box>
              </Stack>
            }
            sx={(currentTheme) => ({
              alignItems: 'stretch',
              color: 'text.secondary',
              justifyContent: { xs: 'center', sm: 'flex-start' },
              minWidth: 0,
              px: { xs: 0, sm: 1.75 },
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
  onTabChange,
  open,
  store,
  tab,
}: {
  onOpenChange: (open: boolean) => void;
  onTabChange: (tab: SettingsTab) => void;
  open: boolean;
  store: ClientStore;
  tab: SettingsTab;
}) => {
  const { t } = useI18n();
  const titleId = useId();
  const title =
    tab === 'models'
      ? t('nav.providers')
      : tab === 'personalization'
        ? t('nav.personalization')
        : t('nav.settings');

  return (
    <Dialog
      aria-labelledby={titleId}
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
            height: { xs: 'calc(100% - 16px)', sm: 'calc(100% - 32px)' },
            maxHeight: 1000,
            maxWidth: 1580,
            overflow: 'hidden',
            width: { xs: 'calc(100% - 16px)', sm: 'calc(100% - 32px)' },
          },
        },
      }}
    >
      <Stack direction="row" sx={{ height: '100%', minHeight: 0 }}>
        <SettingsNavigation onChange={onTabChange} value={tab} />
        <Stack
          sx={{
            bgcolor: 'background.default',
            flex: 1,
            minHeight: 0,
            minWidth: 0,
          }}
        >
          <DialogTitle
            component="div"
            id={titleId}
            sx={{
              alignItems: 'center',
              borderBottom: '1px solid',
              borderBottomColor: 'divider',
              display: 'flex',
              flex: 'none',
              justifyContent: 'space-between',
              minHeight: 68,
              px: { xs: 1.5, sm: 3 },
              py: 1.5,
            }}
          >
            <Typography sx={{ fontSize: 16, fontWeight: 720 }}>
              {title}
            </Typography>
            <IconButton
              aria-label={t('action.close')}
              data-testid="settings-close"
              onClick={() => onOpenChange(false)}
            >
              <CloseRoundedIcon />
            </IconButton>
          </DialogTitle>
          <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
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
      </Stack>
    </Dialog>
  );
};
