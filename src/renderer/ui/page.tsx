import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { ReactNode } from 'react';
import { tokens } from '../theme.js';

export const Page = ({ children }: { children: ReactNode }) => (
  <Stack
    component="section"
    sx={{
      gap: { xs: 3.5, sm: 4.5, lg: 6.5 },
      maxWidth: 1320,
      minHeight: '100%',
      mr: 'auto',
      px: { xs: 3, sm: 5, md: 7 },
      py: { xs: 4, sm: 5.5, lg: 8 },
      width: '100%',
    }}
  >
    {children}
  </Stack>
);

export const PageHeader = ({
  action,
  title,
}: {
  action?: ReactNode;
  title: string;
}) => (
  <Stack
    direction="row"
    sx={{
      alignItems: 'center',
      gap: 3,
      justifyContent: 'space-between',
      minHeight: 52,
    }}
  >
    <Typography
      component="h1"
      sx={{ fontSize: { xs: 34, sm: 42, lg: 52 } }}
      variant="h1"
    >
      {title}
    </Typography>
    {action}
  </Stack>
);

export const Card = ({
  actions,
  children,
  title,
}: {
  actions?: ReactNode;
  children: ReactNode;
  title?: string;
}) => (
  <Paper
    sx={{
      border: '1px solid',
      borderColor: 'divider',
      borderRadius: `${tokens.radiusCard}px`,
      p: { xs: 2.25, sm: 2.75 },
    }}
  >
    <Stack sx={{ gap: 2.5 }}>
      {title ? (
        <Typography component="h2" variant="h2">
          {title}
        </Typography>
      ) : null}
      {children}
      {actions ? (
        <Stack direction="row" sx={{ gap: 1, justifyContent: 'flex-end' }}>
          {actions}
        </Stack>
      ) : null}
    </Stack>
  </Paper>
);

export const EmptyState = ({ children }: { children: ReactNode }) => (
  <Box
    sx={{
      bgcolor: 'action.hover',
      borderRadius: `${tokens.radiusCard}px`,
      color: 'text.secondary',
      fontSize: 13,
      px: 3,
      py: 6,
      textAlign: 'center',
    }}
  >
    {children}
  </Box>
);
