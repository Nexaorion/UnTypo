import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app.js';
import { theme } from './theme.js';

const container = document.getElementById('root');
if (!container) throw new Error('Renderer root element is missing');

const reportRendererIssue = (issue: {
  column?: number;
  line?: number;
  message: string;
  source?: string;
  stack?: string;
}) => {
  void window.untypo?.reportRendererIssue(issue).catch(() => undefined);
};

window.addEventListener('error', (event) => {
  reportRendererIssue({
    column: event.colno,
    line: event.lineno,
    message: event.message || 'Unhandled renderer error',
    source: event.filename,
    ...(event.error instanceof Error && event.error.stack
      ? { stack: event.error.stack }
      : {}),
  });
});

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason as unknown;
  reportRendererIssue({
    message:
      reason instanceof Error
        ? reason.message
        : typeof reason === 'string'
          ? reason
          : 'Unhandled renderer rejection',
    ...(reason instanceof Error && reason.stack ? { stack: reason.stack } : {}),
  });
});

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
