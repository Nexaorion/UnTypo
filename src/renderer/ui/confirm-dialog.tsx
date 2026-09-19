import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import { useId } from 'react';

export interface ConfirmDialogProps {
  cancelLabel: string;
  confirmColor?: 'error' | 'primary';
  confirmLabel: string;
  description?: string;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  pending?: boolean;
  title: string;
}

export const ConfirmDialog = ({
  cancelLabel,
  confirmColor = 'error',
  confirmLabel,
  description,
  onConfirm,
  onOpenChange,
  open,
  pending = false,
  title,
}: ConfirmDialogProps) => {
  const titleId = useId();

  return (
    <Dialog
      aria-labelledby={titleId}
      fullWidth
      maxWidth="xs"
      onClose={() => {
        if (!pending) onOpenChange(false);
      }}
      open={open}
    >
      <DialogTitle id={titleId}>{title}</DialogTitle>
      {description ? (
        <DialogContent>
          <DialogContentText variant="body2">{description}</DialogContentText>
        </DialogContent>
      ) : null}
      <DialogActions sx={{ gap: 1, px: 3, pb: 2.5 }}>
        <Button
          color="inherit"
          disabled={pending}
          onClick={() => onOpenChange(false)}
          variant="text"
        >
          {cancelLabel}
        </Button>
        <Button color={confirmColor} disabled={pending} onClick={onConfirm} variant="outlined">
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
