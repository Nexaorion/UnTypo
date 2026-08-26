import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import FormHelperText from '@mui/material/FormHelperText';
import FormLabel from '@mui/material/FormLabel';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { Fragment, useId, useRef, useState, type KeyboardEvent } from 'react';
import {
  acceleratorFromEvent,
  hotkeyKeycapLabels,
  modifierAcceleratorFromEvent,
} from '../logic/hotkey.js';
import { themeAlpha, themePalette } from '../theme.js';

const modifierOrder = ['Ctrl', 'Alt', 'Shift', 'Win'] as const;

export const HotkeyField = ({
  error,
  label,
  listeningText,
  onChange,
  value,
}: {
  error?: string;
  label: string;
  listeningText: string;
  onChange: (value: string) => void;
  value: string;
}) => {
  const controlId = useId();
  const helperId = `${controlId}-helper`;
  const errorId = `${controlId}-error`;
  const [focused, setFocused] = useState(false);
  const [preview, setPreview] = useState<string>();
  const capturedCombination = useRef(false);
  const heldModifiers = useRef(new Set<string>());
  const modifierChord = useRef(false);
  const displayedValue = preview ?? value;
  const keycaps = hotkeyKeycapLabels(displayedValue);
  const describedBy = [
    ...(focused ? [helperId] : []),
    ...(error ? [errorId] : []),
  ].join(' ');

  const clearCaptureState = () => {
    capturedCombination.current = false;
    heldModifiers.current.clear();
    modifierChord.current = false;
    setPreview(undefined);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat) return;

    const modifier = modifierAcceleratorFromEvent(event);
    if (modifier) {
      heldModifiers.current.add(modifier);
      if (heldModifiers.current.size > 1) modifierChord.current = true;
      setPreview(
        modifierOrder
          .filter((candidate) => heldModifiers.current.has(candidate))
          .join('+'),
      );
      return;
    }

    if (capturedCombination.current) return;
    const accelerator = acceleratorFromEvent(event);
    if (!accelerator) return;
    capturedCombination.current = true;
    setPreview(accelerator);
    onChange(accelerator);
  };

  const handleKeyUp = (event: KeyboardEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();

    const modifier = modifierAcceleratorFromEvent(event);
    if (modifier) {
      if (
        !capturedCombination.current &&
        !modifierChord.current &&
        modifier === 'Alt' &&
        heldModifiers.current.size === 1
      ) {
        onChange(modifier);
      }
      heldModifiers.current.delete(modifier);
      if (heldModifiers.current.size === 0) {
        capturedCombination.current = false;
        modifierChord.current = false;
        setPreview(undefined);
      } else {
        setPreview(
          modifierOrder
            .filter((candidate) => heldModifiers.current.has(candidate))
            .join('+'),
        );
      }
      return;
    }

    if (heldModifiers.current.size === 0) {
      capturedCombination.current = false;
      setPreview(undefined);
    }
  };

  return (
    <Stack sx={{ gap: 0.75, minWidth: 0, width: '100%' }}>
      <FormLabel error={Boolean(error)} htmlFor={controlId}>
        {label}
      </FormLabel>
      <ButtonBase
        aria-describedby={describedBy || undefined}
        data-testid="hotkey-capture"
        id={controlId}
        onBlur={() => {
          setFocused(false);
          clearCaptureState();
        }}
        onFocus={() => setFocused(true)}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        sx={(currentTheme) => ({
          alignItems: { sm: 'center', xs: 'flex-start' },
          backgroundColor: themePalette(currentTheme).background.paper,
          border: '1px solid',
          borderColor: error
            ? 'error.main'
            : focused
              ? 'primary.main'
              : 'divider',
          borderRadius: 4,
          display: 'flex',
          flexDirection: { sm: 'row', xs: 'column' },
          gap: 1.5,
          justifyContent: 'space-between',
          minHeight: 64,
          px: 2,
          py: 1.25,
          textAlign: 'left',
          transition: currentTheme.transitions.create(
            ['border-color', 'box-shadow'],
            { duration: currentTheme.transitions.duration.shorter },
          ),
          width: '100%',
          ...(focused
            ? {
                boxShadow: `0 0 0 3px ${themeAlpha(
                  themePalette(currentTheme).primary.main,
                  0.1,
                )}`,
              }
            : {}),
          '&:hover': {
            borderColor: error ? 'error.main' : 'text.secondary',
          },
        })}
        type="button"
      >
        <Stack
          aria-label={displayedValue}
          direction="row"
          sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 0.65 }}
        >
          {keycaps.map((keycap, index) => (
            <Fragment key={`${keycap}-${String(index)}`}>
              {index > 0 ? (
                <Typography
                  aria-hidden="true"
                  color="text.disabled"
                  component="span"
                  sx={{ fontSize: 13, fontWeight: 700 }}
                >
                  +
                </Typography>
              ) : null}
              <Box
                component="kbd"
                sx={(currentTheme) => ({
                  background: `linear-gradient(180deg, ${themeAlpha(
                    themePalette(currentTheme).text.primary,
                    0.08,
                  )}, ${themeAlpha(
                    themePalette(currentTheme).text.primary,
                    0.025,
                  )})`,
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: 1.5,
                  boxShadow: `0 2px 0 ${themeAlpha(
                    themePalette(currentTheme).text.primary,
                    0.16,
                  )}`,
                  color: 'text.primary',
                  fontFamily: 'inherit',
                  fontSize: 13,
                  fontWeight: 750,
                  lineHeight: 1,
                  minWidth: 34,
                  px: 1.1,
                  py: 0.85,
                  textAlign: 'center',
                })}
              >
                {keycap}
              </Box>
            </Fragment>
          ))}
        </Stack>
        {focused ? (
          <Typography
            color="text.primary"
            id={helperId}
            sx={{ flexShrink: 0, fontSize: 12.5, fontWeight: 650 }}
            variant="caption"
          >
            {listeningText}
          </Typography>
        ) : null}
      </ButtonBase>
      {error ? (
        <FormHelperText error id={errorId}>
          {error}
        </FormHelperText>
      ) : null}
    </Stack>
  );
};
