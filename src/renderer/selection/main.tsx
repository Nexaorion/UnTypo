import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { theme } from '../theme.js';
import { SelectionApp } from './selection-app.js';

const container = document.getElementById('root');
if (!container) throw new Error('Selection root is missing');
createRoot(container).render(
  <StrictMode>
    <ThemeProvider
      defaultMode="system"
      disableTransitionOnChange
      noSsr
      theme={theme}
    >
      <CssBaseline enableColorScheme />
      <SelectionApp />
    </ThemeProvider>
  </StrictMode>,
);
