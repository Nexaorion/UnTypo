import { Toast as BaseToast } from '@base-ui/react/toast';
import type { ReactNode } from 'react';

const ToastList = () => {
  const { toasts } = BaseToast.useToastManager();
  return toasts.map((toast) => (
    <BaseToast.Root className="ui-toast" key={toast.id} toast={toast}>
      <BaseToast.Content className="ui-toast-content">
        <div>
          <BaseToast.Title className="ui-toast-title" />
          <BaseToast.Description className="ui-toast-description" />
        </div>
        <BaseToast.Close
          aria-label="Dismiss notification"
          className="ui-toast-close"
        >
          <svg aria-hidden="true" viewBox="0 0 20 20">
            <path d="M5 5l10 10M15 5L5 15" />
          </svg>
        </BaseToast.Close>
      </BaseToast.Content>
    </BaseToast.Root>
  ));
};

export const ToastProvider = ({ children }: { children: ReactNode }) => (
  <BaseToast.Provider limit={3} timeout={4_000}>
    {children}
    <BaseToast.Portal>
      <BaseToast.Viewport className="ui-toast-viewport">
        <ToastList />
      </BaseToast.Viewport>
    </BaseToast.Portal>
  </BaseToast.Provider>
);

export const useToast = () => {
  const manager = BaseToast.useToastManager();
  return (title: string, description: string) =>
    manager.add({ description, title });
};
