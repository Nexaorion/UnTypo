import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app.js';
import { theme } from './theme.js';

const container = document.getElementById('root');
if (!container) throw new Error('Renderer root element is missing');

createRoot(container).render(
  <StrictMode>
    <ThemeProvider
      defaultMode="system"
      disableTransitionOnChange
      noSsr
      theme={theme}
    >
      <CssBaseline enableColorScheme />
      <App />
    </ThemeProvider>
  </StrictMode>,
);
