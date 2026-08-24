import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import MenuBookRoundedIcon from '@mui/icons-material/MenuBookRounded';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import FormLabel from '@mui/material/FormLabel';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useId, useState } from 'react';
import { useI18n } from '../i18n/context.js';
import {
  addDictionaryEntry,
  removeDictionaryEntry,
  DICTIONARY_LIMITS,
} from '../logic/dictionary.js';
import type { ClientStore } from '../state/client.js';
import { useAction } from '../state/use-action.js';
import { themeAlpha, themePalette } from '../theme.js';
import { Page, PageHeader } from '../ui/page.js';

export const DictionarySection = ({ store }: { store: ClientStore }) => {
  const { t } = useI18n();
  const { isPending, run } = useAction();
  const inputId = useId();
  const [term, setTerm] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);

  const entries = store.snapshot?.dictionary ?? [];

  const add = () => {
    const result = addDictionaryEntry(entries, term);
    if (!result.ok) {
      setError(
        result.reason === 'tooLong'
          ? t('field.tooLong')
          : result.reason === 'duplicate'
            ? t('dictionary.duplicate')
            : result.reason === 'full'
              ? t('dictionary.full')
              : t('field.required'),
      );
      return;
    }
    setError(undefined);
    void run('add', async () => {
      await store.setDictionary(result.entries);
      setTerm('');
    });
  };

  return (
    <Page>
      <PageHeader title={t('nav.personalization')} />

      <Stack component="section" sx={{ gap: 3.5 }}>
        <Stack
          direction="row"
          sx={{
            alignItems: 'flex-end',
            gap: 3,
            justifyContent: 'space-between',
            pr: { xs: 0, sm: 1 },
          }}
        >
          <Stack sx={{ gap: 0.75 }}>
            <Typography component="h2" variant="h2">
              {t('dictionary.title')}
            </Typography>
            <Typography color="text.secondary" variant="body2">
              {t('dictionary.subtitle')}
            </Typography>
          </Stack>
          <Typography
            color="text.secondary"
            sx={{ flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}
            variant="body2"
          >
            {entries.length} / {DICTIONARY_LIMITS.entries}
          </Typography>
        </Stack>

        <Divider />

        <Stack
          component="form"
          onSubmit={(event) => {
            event.preventDefault();
            add();
          }}
          sx={{ gap: 1 }}
        >
          <FormLabel error={error !== undefined} htmlFor={inputId}>
            {t('dictionary.newEntry')}
          </FormLabel>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            sx={{ alignItems: { sm: 'flex-start' }, gap: 1.5 }}
          >
            <TextField
              autoComplete="off"
              error={error !== undefined}
              fullWidth
              helperText={error}
              id={inputId}
              onChange={(event) => {
                setTerm(event.target.value);
                setError(undefined);
              }}
              placeholder={t('dictionary.placeholder')}
              slotProps={{
                htmlInput: { maxLength: DICTIONARY_LIMITS.termLength },
              }}
              sx={{ '& .MuiOutlinedInput-root': { minHeight: 48 } }}
              value={term}
            />
            <Button
              disabled={isPending('add')}
              sx={{ flexShrink: 0, minHeight: 48, px: 3 }}
              type="submit"
              variant="contained"
            >
              {t('action.add')}
            </Button>
          </Stack>
        </Stack>

        {entries.length === 0 ? (
          <Box
            sx={{
              display: 'grid',
              minHeight: { xs: 240, sm: 340 },
              placeItems: 'center',
              py: 4,
            }}
          >
            <Stack
              sx={{ alignItems: 'center', gap: 1.25, textAlign: 'center' }}
            >
              <Box
                sx={{
                  alignItems: 'center',
                  bgcolor: 'action.hover',
                  borderRadius: 3,
                  color: 'text.disabled',
                  display: 'flex',
                  height: 64,
                  justifyContent: 'center',
                  mb: 0.75,
                  width: 64,
                }}
              >
                <MenuBookRoundedIcon sx={{ fontSize: 34 }} />
              </Box>
              <Typography component="h3" sx={{ fontSize: 18, fontWeight: 720 }}>
                {t('dictionary.emptyTitle')}
              </Typography>
              <Typography color="text.secondary" variant="body2">
                {t('dictionary.emptyDescription')}
              </Typography>
            </Stack>
          </Box>
        ) : (
          <Box
            sx={{
              display: 'grid',
              gap: 1.25,
              gridTemplateColumns: {
                sm: 'repeat(2, minmax(0, 1fr))',
                xl: 'repeat(3, minmax(0, 1fr))',
                xs: 'minmax(0, 1fr)',
              },
            }}
          >
            {entries.map((entry) => (
              <Paper
                key={entry}
                sx={(currentTheme) => ({
                  alignItems: 'center',
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: 2.5,
                  display: 'flex',
                  gap: 1.5,
                  minHeight: 56,
                  px: 1.75,
                  py: 1,
                  transition: currentTheme.transitions.create(
                    ['border-color', 'background-color'],
                    { duration: currentTheme.transitions.duration.shorter },
                  ),
                  '&:hover': {
                    backgroundColor: 'action.hover',
                    borderColor: themeAlpha(
                      themePalette(currentTheme).primary.main,
                      0.36,
                    ),
                  },
                })}
              >
                <AutoAwesomeRoundedIcon
                  aria-hidden="true"
                  color="primary"
                  sx={{ fontSize: 18 }}
                />
                <Typography
                  sx={{ flex: 1, fontSize: 14.5, fontWeight: 560, minWidth: 0 }}
                >
                  {entry}
                </Typography>
                <IconButton
                  aria-label={t('dictionary.remove', { term: entry })}
                  disabled={isPending(`remove-${entry}`)}
                  onClick={() =>
                    void run(`remove-${entry}`, () =>
                      store.setDictionary(
                        removeDictionaryEntry(entries, entry),
                      ),
                    )
                  }
                  size="small"
                >
                  <DeleteOutlineRoundedIcon fontSize="small" />
                </IconButton>
              </Paper>
            ))}
          </Box>
        )}
      </Stack>
    </Page>
  );
};
