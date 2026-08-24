import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded';
import HomeRoundedIcon from '@mui/icons-material/HomeRounded';
import MenuBookRoundedIcon from '@mui/icons-material/MenuBookRounded';
import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded';
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';
import Box from '@mui/material/Box';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useEffect, useRef, type ReactElement, type ReactNode } from 'react';
import { useI18n } from './i18n/context.js';
import { themeAlpha, themePalette } from './theme.js';

export type AppPage = 'dictionary' | 'history' | 'home' | 'models' | 'settings';

const NavigationItem = ({
  icon,
  label,
  onSelect,
  page,
  selected,
  testId,
}: {
  icon: ReactElement;
  label: string;
  onSelect: (page: AppPage) => void;
  page: AppPage;
  selected: boolean;
  testId?: string;
}) => (
  <ListItemButton
    data-testid={testId}
    onClick={() => onSelect(page)}
    selected={selected}
    sx={(currentTheme) => ({
      color: selected ? 'primary.main' : 'text.secondary',
      minHeight: 46,
      px: 1.5,
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
      },
      '&.Mui-selected:hover': {
        backgroundColor: themeAlpha(
          themePalette(currentTheme).primary.main,
          0.14,
        ),
      },
      '@media (max-width: 700px)': {
        justifyContent: 'center',
        px: 0,
      },
    })}
  >
    <ListItemIcon
      sx={{
        color: 'inherit',
        minWidth: 0,
        mr: 1.5,
        '@media (max-width: 700px)': { mr: 0 },
      }}
    >
      {icon}
    </ListItemIcon>
    <ListItemText
      primary={label}
      slotProps={{
        primary: { sx: { fontSize: 14, fontWeight: selected ? 700 : 580 } },
      }}
      sx={{ '@media (max-width: 700px)': { display: 'none' } }}
    />
  </ListItemButton>
);

export const AppShell = ({
  children,
  onSelect,
  page,
  version,
}: {
  children: ReactNode;
  onSelect: (page: AppPage) => void;
  page: AppPage;
  version?: string;
}) => {
  const { t } = useI18n();
  const contentRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }, [page]);

  const primaryItems: readonly {
    icon: ReactElement;
    label: string;
    page: AppPage;
    testId: string;
  }[] = [
    {
      icon: <HomeRoundedIcon />,
      label: t('nav.home'),
      page: 'home',
      testId: 'home-open',
    },
    {
      icon: <HistoryRoundedIcon />,
      label: t('nav.history'),
      page: 'history',
      testId: 'history-open',
    },
    {
      icon: <MenuBookRoundedIcon />,
      label: t('nav.dictionary'),
      page: 'dictionary',
      testId: 'dictionary-open',
    },
  ];
  const utilityItems: readonly {
    icon: ReactElement;
    label: string;
    page: AppPage;
    testId?: string;
  }[] = [
    {
      icon: <SettingsRoundedIcon />,
      label: t('nav.settings'),
      page: 'settings',
      testId: 'settings-open',
    },
    {
      icon: <SmartToyOutlinedIcon />,
      label: t('nav.providers'),
      page: 'models',
      testId: 'models-open',
    },
  ];

  return (
    <Stack
      direction="row"
      sx={{ bgcolor: 'background.default', height: '100vh', minHeight: 0 }}
    >
      <Stack
        component="aside"
        sx={(currentTheme) => ({
          backgroundColor: '#f5f5f5',
          borderRight: '1px solid',
          borderRightColor: 'divider',
          flexShrink: 0,
          minHeight: 0,
          p: { xs: 2.25, md: 3.5 },
          width: { xs: 204, md: 'clamp(236px, 19.5vw, 310px)' },
          ...currentTheme.applyStyles('dark', {
            backgroundColor: '#1a1a1a',
          }),
          '@media (max-width: 700px)': {
            p: 1.5,
            width: 76,
          },
        })}
      >
        <Stack
          direction="row"
          sx={{
            alignItems: 'center',
            minHeight: 42,
            px: 0.75,
            '@media (max-width: 700px)': { justifyContent: 'center', px: 0 },
          }}
        >
          <Typography
            sx={{
              fontSize: 18,
              fontWeight: 760,
              letterSpacing: '-0.025em',
              whiteSpace: 'nowrap',
              '@media (max-width: 700px)': {
                fontSize: 11,
                letterSpacing: '-0.04em',
              },
            }}
          >
            UnTypo
          </Typography>
        </Stack>

        <Stack component="nav" sx={{ gap: 0.75, mt: 4 }}>
          {primaryItems.map((item) => (
            <NavigationItem
              icon={item.icon}
              key={item.page}
              label={item.label}
              onSelect={onSelect}
              page={item.page}
              selected={page === item.page}
              testId={item.testId}
            />
          ))}
        </Stack>

        <Stack sx={{ gap: 0.75, mt: 'auto' }}>
          {utilityItems.map((item) => (
            <NavigationItem
              icon={item.icon}
              key={item.page}
              label={item.label}
              onSelect={onSelect}
              page={item.page}
              selected={page === item.page}
              testId={item.testId}
            />
          ))}
          {version ? (
            <Typography
              color="text.disabled"
              sx={{
                fontSize: 11,
                lineHeight: 1.4,
                mt: 1.25,
                px: 1.5,
                '@media (max-width: 700px)': {
                  fontSize: 9.5,
                  px: 0,
                  textAlign: 'center',
                },
              }}
            >
              v{version}
            </Typography>
          ) : null}
        </Stack>
      </Stack>

      <Box
        component="main"
        ref={contentRef}
        sx={{ flex: 1, minWidth: 0, overflowY: 'auto', position: 'relative' }}
      >
        {children}
      </Box>
    </Stack>
  );
};
