import AccessTimeRoundedIcon from '@mui/icons-material/AccessTimeRounded';
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded';
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded';
import KeyboardVoiceRoundedIcon from '@mui/icons-material/KeyboardVoiceRounded';
import TextFieldsRoundedIcon from '@mui/icons-material/TextFieldsRounded';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { ReactNode } from 'react';
import type {
  ClientHistoryRecord,
  ClientUsageStats,
} from '../../shared/ipc.js';
import { useI18n } from '../i18n/context.js';
import { formatTimestamp } from '../logic/history.js';
import { themeAlpha, themePalette, tokens } from '../theme.js';

const MANUAL_TYPING_CHARACTERS_PER_SECOND = 2.4;

const formatDuration = (milliseconds: number, locale: string): string => {
  const safeMilliseconds = Math.max(0, milliseconds);
  const minutes = Math.floor(safeMilliseconds / 60_000);
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (safeMilliseconds > 0 && minutes === 0) {
    return locale === 'zh-CN' ? '不足 1 分钟' : '< 1 min';
  }

  if (locale === 'zh-CN') {
    if (hours > 0) return `${hours} 小时 ${remainingMinutes} 分钟`;
    return `${remainingMinutes} 分钟`;
  }
  if (hours > 0) return `${hours}h ${remainingMinutes}m`;
  return `${remainingMinutes}m`;
};

const estimateSavedMilliseconds = (usage: ClientUsageStats): number =>
  Math.max(
    0,
    Math.round(
      (usage.outputCharacters / MANUAL_TYPING_CHARACTERS_PER_SECOND) * 1_000 -
        usage.transcriptionDurationMs,
    ),
  );

const StatCard = ({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) => (
  <Paper
    sx={{
      border: '1px solid',
      borderColor: 'divider',
      borderRadius: `${tokens.radiusCard + 2}px`,
      minWidth: 0,
      p: 2.25,
      '@media (max-height: 680px)': { p: 1.5 },
    }}
  >
    <Stack sx={{ gap: 2.5, '@media (max-height: 680px)': { gap: 1 } }}>
      <Stack
        direction="row"
        sx={{ alignItems: 'center', color: 'text.secondary', gap: 1 }}
      >
        {icon}
        <Typography variant="caption">{label}</Typography>
      </Stack>
      <Typography
        sx={{
          fontSize: 20,
          fontWeight: 700,
          letterSpacing: '-0.025em',
          lineHeight: 1.1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          '@media (max-height: 680px)': { fontSize: 18 },
        }}
      >
        {value}
      </Typography>
    </Stack>
  </Paper>
);

export const HomeSection = ({
  history,
  hotkey,
  onOpenHistory,
  userName,
  usage,
}: {
  history: readonly ClientHistoryRecord[];
  hotkey: string;
  onOpenHistory: () => void;
  userName: string;
  usage: ClientUsageStats | null;
}) => {
  const { locale, t } = useI18n();
  const currentUsage: ClientUsageStats = usage ?? {
    outputCharacters: 0,
    transcriptionDurationMs: 0,
    usageCount: 0,
  };
  const savedMilliseconds = estimateSavedMilliseconds(currentUsage);
  const numberFormatter = new Intl.NumberFormat(locale);
  const recentHistory = history.slice(0, 4);

  return (
    <Stack
      component="section"
      sx={{
        boxSizing: 'border-box',
        gap: { xs: 2.5, sm: 3 },
        minHeight: '100%',
        margin: '0 auto',
        maxWidth: 1320,
        px: { xs: 2.5, sm: 5, md: 7 },
        py: { xs: 3, sm: 4 },
        width: '100%',
        '@media (max-height: 680px)': { gap: 2, py: 2.5 },
      }}
    >
      <Stack sx={{ gap: 1 }}>
        <Typography
          component="h1"
          sx={{
            fontSize: { xs: 34, sm: 44 },
            fontWeight: 750,
            letterSpacing: '-0.045em',
            lineHeight: 1.1,
            '@media (max-height: 680px)': { fontSize: 34 },
          }}
        >
          {t('home.welcome', { name: userName })}
        </Typography>
        <Typography color="text.secondary" variant="body2">
          {t('home.subtitle')}
        </Typography>
      </Stack>

      <Paper
        sx={(currentTheme) => ({
          backgroundColor: themeAlpha(
            themePalette(currentTheme).primary.main,
            0.055,
          ),
          border: '1px solid',
          borderColor: themeAlpha(
            themePalette(currentTheme).primary.main,
            0.18,
          ),
          borderRadius: `${tokens.radiusCard + 2}px`,
          p: { xs: 2.25, sm: 2.75 },
          '@media (max-height: 680px)': { p: 1.75 },
        })}
      >
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          sx={{
            alignItems: { sm: 'center' },
            gap: 2.25,
            '@media (max-height: 680px)': { gap: 1.5 },
          }}
        >
          <Box
            sx={{
              bgcolor: 'primary.main',
              borderRadius: 3,
              color: 'primary.contrastText',
              display: 'grid',
              flexShrink: 0,
              height: 48,
              placeItems: 'center',
              width: 48,
              '@media (max-height: 680px)': { height: 42, width: 42 },
            }}
          >
            <KeyboardVoiceRoundedIcon />
          </Box>
          <Stack sx={{ flex: 1, gap: 0.5 }}>
            <Typography component="h2" variant="h2">
              {t('home.quickStart.title')}
            </Typography>
            <Typography
              color="text.secondary"
              sx={{
                '@media (max-height: 680px)': {
                  fontSize: 13,
                  lineHeight: 1.45,
                },
              }}
              variant="body2"
            >
              {t('home.quickStart.description')}
            </Typography>
          </Stack>
          <Box
            component="kbd"
            sx={{
              bgcolor: 'background.paper',
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 2,
              boxShadow: '0 1px 2px rgb(0 0 0 / 8%)',
              color: 'text.primary',
              flexShrink: 0,
              fontFamily: 'inherit',
              fontSize: 13,
              fontWeight: 700,
              px: 1.75,
              py: 1.15,
              '@media (max-height: 680px)': {
                fontSize: 11.5,
                px: 1.25,
                py: 0.9,
              },
            }}
          >
            {hotkey.replaceAll('+', ' + ')}
          </Box>
        </Stack>
      </Paper>

      <Box
        sx={{
          display: 'grid',
          gap: 1.5,
          gridTemplateColumns: {
            lg: 'repeat(4, minmax(0, 1fr))',
            sm: 'repeat(2, minmax(0, 1fr))',
            xs: '1fr',
          },
        }}
      >
        <StatCard
          icon={<AccessTimeRoundedIcon fontSize="small" />}
          label={t('home.stat.dictationTime')}
          value={formatDuration(currentUsage.transcriptionDurationMs, locale)}
        />
        <StatCard
          icon={<TextFieldsRoundedIcon fontSize="small" />}
          label={t('home.stat.characters')}
          value={numberFormatter.format(currentUsage.outputCharacters)}
        />
        <StatCard
          icon={<AutoAwesomeRoundedIcon fontSize="small" />}
          label={t('home.stat.timeSaved')}
          value={formatDuration(savedMilliseconds, locale)}
        />
        <StatCard
          icon={<HistoryRoundedIcon fontSize="small" />}
          label={t('home.stat.model')}
          value={currentUsage.mostUsedModel ?? t('home.stat.noModel')}
        />
      </Box>

      <Paper
        sx={{
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: `${tokens.radiusCard + 2}px`,
          minHeight: recentHistory.length > 0 ? 232 : 0,
          p: { xs: 2, sm: 2.75 },
          '@media (max-height: 680px)': { p: 1.5 },
        }}
      >
        <Stack sx={{ gap: 1.5 }}>
          <Stack
            direction="row"
            sx={{ alignItems: 'center', justifyContent: 'space-between' }}
          >
            <Typography component="h2" variant="h2">
              {t('home.history.title')}
            </Typography>
            <Button onClick={onOpenHistory} variant="text">
              {t('action.viewAll')}
            </Button>
          </Stack>

          {recentHistory.length === 0 ? (
            <Box
              sx={{
                bgcolor: 'action.hover',
                borderRadius: `${tokens.radiusControl}px`,
                color: 'text.secondary',
                display: 'grid',
                minHeight: 72,
                px: 2,
                placeItems: 'center',
                textAlign: 'center',
                '@media (max-height: 680px)': { minHeight: 56 },
              }}
            >
              <Typography variant="body2">{t('home.history.empty')}</Typography>
            </Box>
          ) : (
            <Stack sx={{ gap: 0.25 }}>
              {recentHistory.map((record) => (
                <Stack
                  direction="row"
                  key={record.id}
                  sx={{
                    alignItems: 'center',
                    borderRadius: `${tokens.radiusControl}px`,
                    gap: 2,
                    minWidth: 0,
                    px: 1,
                    py: 1.25,
                    '&:hover': { backgroundColor: 'action.hover' },
                  }}
                >
                  <Typography
                    sx={{
                      flex: 1,
                      fontSize: 13,
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {record.outputText}
                  </Typography>
                  <Typography
                    color="text.secondary"
                    component="time"
                    sx={{ flexShrink: 0 }}
                    variant="caption"
                  >
                    {formatTimestamp(record.createdAt, locale)}
                  </Typography>
                </Stack>
              ))}
            </Stack>
          )}
        </Stack>
      </Paper>
    </Stack>
  );
};
