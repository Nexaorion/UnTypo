import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import FormHelperText from '@mui/material/FormHelperText';
import FormLabel from '@mui/material/FormLabel';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import {
  Fragment,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import type { HotkeyCaptureInput } from '../../shared/ipc.js';
import {
  applyHotkeyCaptureInput,
  createHotkeyCaptureSession,
  hotkeyKeycapLabels,
  resetHotkeyCaptureSession,
} from '../logic/hotkey.js';
import { themeAlpha, themePalette } from '../theme.js';

export const HotkeyField = ({
  error,
  label,
  listeningText,
  onCaptureActive,
  onChange,
  platform,
  value,
}: {
  error?: string;
  label: string;
  listeningText: string;
  onCaptureActive?: (active: boolean) => void;
  onChange: (value: string) => void;
  platform?: string;
  value: string;
}) => {
  const controlId = useId();
  const helperId = `${controlId}-helper`;
  const errorId = `${controlId}-error`;
  const [focused, setFocused] = useState(false);
  const [preview, setPreview] = useState<string>();
  const session = useRef(createHotkeyCaptureSession());
  const onChangeRef = useRef(onChange);
  const onCaptureActiveRef = useRef(onCaptureActive);
  const preferMainCapture = useRef(false);
  onChangeRef.current = onChange;
  onCaptureActiveRef.current = onCaptureActive;
  const displayedValue = preview ?? value;
  const keycaps = hotkeyKeycapLabels(displayedValue, platform);
  const describedBy = [
    ...(focused ? [helperId] : []),
    ...(error ? [errorId] : []),
  ].join(' ');

  const consumeStroke = (input: HotkeyCaptureInput) => {
    const { commit } = applyHotkeyCaptureInput(session.current, input);
    setPreview(session.current.preview);
    if (commit) onChangeRef.current(commit);
  };

  const clearCaptureState = () => {
    preferMainCapture.current = false;
    resetHotkeyCaptureSession(session.current);
    setPreview(undefined);
  };

  useEffect(() => {
    if (!focused) return;
    const api = window.untypo;
    if (!api?.onHotkeyCaptureEvent) return;
    return api.onHotkeyCaptureEvent((input) => {
      preferMainCapture.current = true;
      consumeStroke(input);
    });
  }, [focused]);

  useEffect(
    () => () => {
      onCaptureActiveRef.current?.(false);
    },
    [],
  );

  const handleBrowserKey = (
    event: KeyboardEvent<HTMLButtonElement>,
    type: 'keyDown' | 'keyUp',
  ) => {
    event.preventDefault();
    event.stopPropagation();
    if (preferMainCapture.current) return;
    consumeStroke({
      altKey: event.altKey,
      code: event.code,
      ctrlKey: event.ctrlKey,
      key: event.key,
      metaKey: event.metaKey,
      repeat: event.repeat,
      shiftKey: event.shiftKey,
      type,
    });
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
          onCaptureActive?.(false);
        }}
        onFocus={() => {
          setFocused(true);
          onCaptureActive?.(true);
        }}
        onKeyDown={(event) => handleBrowserKey(event, 'keyDown')}
        onKeyUp={(event) => handleBrowserKey(event, 'keyUp')}
        onPointerDown={() => {
          onCaptureActive?.(true);
        }}
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
