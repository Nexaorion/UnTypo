import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Snackbar from '@mui/material/Snackbar';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export interface ToastOptions {
  description?: string;
  type?: 'error' | 'success';
}

type Notify = (title: string, options?: ToastOptions) => void;

interface Toast extends ToastOptions {
  key: number;
  title: string;
}

const ToastContext = createContext<Notify | null>(null);

export const ToastProvider = ({
  children,
  closeLabel,
}: {
  children: ReactNode;
  closeLabel: string;
}) => {
  const [toast, setToast] = useState<Toast | null>(null);

  const notify = useCallback<Notify>((title, options = {}) => {
    setToast({ ...options, key: Date.now(), title });
  }, []);

  const value = useMemo(() => notify, [notify]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <Snackbar
        anchorOrigin={{ horizontal: 'center', vertical: 'bottom' }}
        autoHideDuration={5_000}
        key={toast?.key}
        onClose={(_event, reason) => {
          if (reason !== 'clickaway') setToast(null);
        }}
        open={toast !== null}
      >
        <Alert
          closeText={closeLabel}
          onClose={() => setToast(null)}
          severity={toast?.type === 'error' ? 'error' : 'success'}
          sx={{ alignItems: 'center', maxWidth: 420 }}
        >
          {toast?.description ? <AlertTitle>{toast.title}</AlertTitle> : null}
          {toast?.description ?? toast?.title}
        </Alert>
      </Snackbar>
    </ToastContext.Provider>
  );
};

export const useToast = (): Notify => {
  const notify = useContext(ToastContext);
  if (!notify) throw new Error('useToast requires ToastProvider');
  return notify;
};
