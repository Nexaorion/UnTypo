import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import { Transition } from '@headlessui/react';
import { useRef, useState, type ReactNode } from 'react';
import { Button } from './button';

export interface DialogProps {
  children: ReactNode;
  description: string;
  title: string;
  triggerLabel: string;
}

export const Dialog = ({
  children,
  description,
  title,
  triggerLabel,
}: DialogProps) => {
  const [open, setOpen] = useState(false);
  const actionsRef = useRef<BaseDialog.Root.Actions>(null);

  return (
    <BaseDialog.Root
      actionsRef={actionsRef}
      onOpenChange={(nextOpen, details) => {
        if (!nextOpen) details.preventUnmountOnClose();
        setOpen(nextOpen);
      }}
      open={open}
    >
      <BaseDialog.Trigger render={<Button variant="primary" />}>
        {triggerLabel}
      </BaseDialog.Trigger>
      <BaseDialog.Portal keepMounted>
        <Transition
          afterLeave={() => actionsRef.current?.unmount()}
          appear
          enter="ui-transition"
          enterFrom="ui-transition--hidden"
          enterTo="ui-transition--visible"
          leave="ui-transition"
          leaveFrom="ui-transition--visible"
          leaveTo="ui-transition--hidden"
          show={open}
        >
          <div className="ui-dialog-layer">
            <BaseDialog.Backdrop className="ui-dialog-backdrop" />
            <BaseDialog.Viewport className="ui-dialog-viewport">
              <BaseDialog.Popup className="ui-dialog-popup">
                <div className="ui-dialog-heading">
                  <div>
                    <BaseDialog.Title className="ui-dialog-title">
                      {title}
                    </BaseDialog.Title>
                    <BaseDialog.Description className="ui-dialog-description">
                      {description}
                    </BaseDialog.Description>
                  </div>
                  <BaseDialog.Close
                    aria-label="Close dialog"
                    className="ui-popup-close"
                  >
                    <svg aria-hidden="true" viewBox="0 0 20 20">
                      <path d="M5 5l10 10M15 5L5 15" />
                    </svg>
                  </BaseDialog.Close>
                </div>
                <div className="ui-dialog-content">{children}</div>
                <div className="ui-dialog-actions">
                  <BaseDialog.Close render={<Button variant="secondary" />}>
                    Cancel
                  </BaseDialog.Close>
                  <BaseDialog.Close render={<Button variant="primary" />}>
                    Save preview
                  </BaseDialog.Close>
                </div>
              </BaseDialog.Popup>
            </BaseDialog.Viewport>
          </div>
        </Transition>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
};
