import { alpha, createTheme, type Theme } from '@mui/material/styles';

export const tokens = {
  duration: 160,
  radiusCard: 24,
  radiusControl: 16,
  radiusDialog: 28,
} as const;

export const themePalette = (currentTheme: Theme) =>
  currentTheme.vars?.palette ?? currentTheme.palette;

export const themeAlpha = (color: string, opacity: number): string =>
  color.startsWith('var(')
    ? `color-mix(in srgb, ${color} ${opacity * 100}%, transparent)`
    : alpha(color, opacity);

const fontFamily = [
  'Inter',
  '"Noto Sans SC"',
  '"Microsoft YaHei UI"',
  '"Segoe UI Variable"',
  '"Segoe UI"',
  'ui-sans-serif',
  'system-ui',
  'sans-serif',
].join(',');

export const theme = createTheme({
  colorSchemes: {
    light: {
      palette: {
        action: {
          disabled: '#a3a3a3',
          disabledBackground: '#f1f1f1',
          hover: 'rgba(0, 0, 0, 0.05)',
          selected: 'rgba(0, 0, 0, 0.08)',
        },
        background: { default: '#ffffff', paper: '#ffffff' },
        divider: '#e5e5e5',
        error: { light: '#fef3f2', main: '#d92d20' },
        primary: { contrastText: '#ffffff', main: '#111111' },
        text: {
          disabled: '#a3a3a3',
          primary: '#111111',
          secondary: '#6b6b6b',
        },
      },
    },
    dark: {
      palette: {
        action: {
          disabled: '#737373',
          disabledBackground: '#242424',
          hover: 'rgba(255, 255, 255, 0.06)',
          selected: 'rgba(255, 255, 255, 0.1)',
        },
        background: { default: '#111111', paper: '#161616' },
        divider: '#303030',
        error: { light: '#3b1d24', main: '#f97066' },
        primary: { contrastText: '#111111', main: '#f5f5f5' },
        text: {
          disabled: '#737373',
          primary: '#f5f5f5',
          secondary: '#a3a3a3',
        },
      },
    },
  },
  cssVariables: {
    colorSchemeSelector: 'media',
    cssVarPrefix: 'untypo',
  },
  components: {
    MuiAlert: {
      defaultProps: { variant: 'outlined' },
      styleOverrides: {
        root: ({ theme: currentTheme }) => ({
          backgroundColor: themeAlpha(
            currentTheme.vars.palette.background.paper,
            0.92,
          ),
          borderColor: currentTheme.vars.palette.divider,
        }),
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true, size: 'medium' },
      styleOverrides: {
        contained: ({ theme: currentTheme }) => ({
          boxShadow: `0 1px 2px ${themeAlpha(currentTheme.vars.palette.primary.main, 0.18)}`,
          '&:hover': {
            boxShadow: `0 4px 12px ${themeAlpha(currentTheme.vars.palette.primary.main, 0.2)}`,
          },
        }),
        outlined: ({ theme: currentTheme }) => ({
          borderColor: currentTheme.vars.palette.divider,
          color: currentTheme.vars.palette.text.primary,
          '&:hover': {
            backgroundColor: currentTheme.vars.palette.action.hover,
            borderColor: currentTheme.vars.palette.text.secondary,
          },
        }),
        root: {
          borderRadius: 999,
          fontSize: 14,
          fontWeight: 700,
          minHeight: 42,
          minWidth: 0,
          paddingInline: 20,
        },
        text: ({ theme: currentTheme }) => ({
          color: currentTheme.vars.palette.text.secondary,
          '&:hover': {
            backgroundColor: currentTheme.vars.palette.action.hover,
            color: currentTheme.vars.palette.text.primary,
          },
        }),
      },
    },
    MuiButtonBase: { defaultProps: { disableRipple: true } },
    MuiChip: {
      styleOverrides: {
        outlined: ({ theme: currentTheme }) => ({
          borderColor: currentTheme.vars.palette.divider,
        }),
        root: { borderRadius: 999, fontSize: 12, fontWeight: 650 },
      },
    },
    MuiCssBaseline: {
      styleOverrides: {
        '*': { boxSizing: 'border-box' },
        '*::-webkit-scrollbar': { height: 10, width: 10 },
        '*::-webkit-scrollbar-thumb': {
          backgroundColor: 'color-mix(in srgb, currentColor 20%, transparent)',
          backgroundClip: 'padding-box',
          border: '3px solid transparent',
          borderRadius: 999,
        },
        '*::-webkit-scrollbar-track': { background: 'transparent' },
        ':focus-visible': {
          outline: '2px solid var(--untypo-palette-primary-main)',
          outlineOffset: 2,
        },
        '::selection': {
          background: 'var(--untypo-palette-primary-main)',
          color: 'var(--untypo-palette-primary-contrastText)',
        },
        'html, body, #root': { height: '100%' },
        '@media (prefers-reduced-motion: reduce)': {
          '*': {
            animationDuration: '0.01ms !important',
            animationIterationCount: '1 !important',
            scrollBehavior: 'auto !important',
            transitionDuration: '0.01ms !important',
          },
        },
        body: {
          fontSynthesis: 'none',
          margin: 0,
          textRendering: 'optimizeLegibility',
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: ({ theme: currentTheme }) => ({
          backgroundImage: 'none',
          border: `1px solid ${currentTheme.vars.palette.divider}`,
          borderRadius: tokens.radiusDialog,
          boxShadow: `0 24px 80px ${alpha('#000000', 0.16)}`,
          ...currentTheme.applyStyles('dark', {
            boxShadow: `0 24px 80px ${alpha('#000000', 0.42)}`,
          }),
        }),
      },
    },
    MuiDialogTitle: {
      styleOverrides: { root: { fontSize: 20, fontWeight: 700 } },
    },
    MuiFormHelperText: { styleOverrides: { root: { marginInline: 0 } } },
    MuiFormLabel: {
      styleOverrides: {
        root: ({ theme: currentTheme }) => ({
          color: currentTheme.vars.palette.text.primary,
          fontSize: 14,
          fontWeight: 650,
          '&.Mui-focused': { color: currentTheme.vars.palette.text.primary },
        }),
      },
    },
    MuiListItemButton: {
      styleOverrides: { root: { borderRadius: 999 } },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        input: ({ theme: currentTheme }) => ({
          '&::placeholder': {
            color: currentTheme.vars.palette.text.secondary,
            opacity: 0.78,
          },
        }),
        root: ({ theme: currentTheme }) => ({
          backgroundColor: currentTheme.vars.palette.background.paper,
          borderRadius: tokens.radiusControl,
          fontSize: 14,
          minHeight: 44,
          '& .MuiOutlinedInput-notchedOutline': {
            borderColor: currentTheme.vars.palette.divider,
          },
          '&:hover .MuiOutlinedInput-notchedOutline': {
            borderColor: currentTheme.vars.palette.text.secondary,
          },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
            borderColor: currentTheme.vars.palette.primary.main,
            borderWidth: 1.5,
          },
          '&.Mui-disabled': {
            backgroundColor:
              currentTheme.vars.palette.action.disabledBackground,
          },
        }),
      },
    },
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: { root: { backgroundImage: 'none' } },
    },
    MuiSwitch: {
      styleOverrides: {
        switchBase: ({ theme: currentTheme }) => ({
          color: currentTheme.vars.palette.text.disabled,
          '&.Mui-checked': {
            color: currentTheme.vars.palette.primary.contrastText,
          },
          '&.Mui-checked + .MuiSwitch-track': {
            backgroundColor: currentTheme.vars.palette.primary.main,
            opacity: 1,
          },
        }),
        track: ({ theme: currentTheme }) => ({
          backgroundColor: currentTheme.vars.palette.text.disabled,
          opacity: 0.48,
        }),
      },
    },
    MuiTab: {
      styleOverrides: {
        root: {
          alignItems: 'flex-start',
          borderRadius: 999,
          fontSize: 14,
          fontWeight: 650,
          minHeight: 46,
          paddingInline: 14,
          textAlign: 'start',
        },
      },
    },
    MuiTabs: { styleOverrides: { indicator: { width: 3 } } },
    MuiTextField: { defaultProps: { size: 'small', variant: 'outlined' } },
    MuiTooltip: {
      styleOverrides: {
        tooltip: ({ theme: currentTheme }) => ({
          backgroundColor: currentTheme.vars.palette.text.primary,
          color: currentTheme.vars.palette.background.paper,
          fontSize: 12,
        }),
      },
    },
  },
  shape: { borderRadius: tokens.radiusControl },
  transitions: {
    duration: {
      enteringScreen: tokens.duration,
      leavingScreen: tokens.duration,
      short: tokens.duration,
      shorter: tokens.duration,
      shortest: tokens.duration,
      standard: tokens.duration,
    },
  },
  typography: {
    body2: { fontSize: 14, lineHeight: 1.65 },
    button: {
      fontWeight: 650,
      letterSpacing: 0,
      textTransform: 'none',
    },
    caption: { fontSize: 12.5, lineHeight: 1.55 },
    fontFamily,
    h1: {
      fontSize: 42,
      fontWeight: 760,
      letterSpacing: '-0.04em',
      lineHeight: 1.12,
    },
    h2: {
      fontSize: 20,
      fontWeight: 720,
      letterSpacing: '-0.02em',
      lineHeight: 1.3,
    },
  },
});
