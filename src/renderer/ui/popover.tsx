import { Popover as BasePopover } from '@base-ui/react/popover';
import { Transition } from '@headlessui/react';
import { useRef, useState, type ReactNode } from 'react';
import { Button } from './button';

export interface PopoverProps {
  children: ReactNode;
  title: string;
  triggerLabel: string;
}

export const Popover = ({ children, title, triggerLabel }: PopoverProps) => {
  const [open, setOpen] = useState(false);
  const actionsRef = useRef<BasePopover.Root.Actions>(null);

  return (
    <BasePopover.Root
      actionsRef={actionsRef}
      onOpenChange={(nextOpen, details) => {
        if (!nextOpen) details.preventUnmountOnClose();
        setOpen(nextOpen);
      }}
      open={open}
    >
      <BasePopover.Trigger render={<Button variant="secondary" />}>
        {triggerLabel}
      </BasePopover.Trigger>
      <BasePopover.Portal keepMounted>
        <BasePopover.Positioner
          align="start"
          className="ui-popover-positioner"
          sideOffset={8}
        >
          <Transition
            afterLeave={() => actionsRef.current?.unmount()}
            appear
            enter="ui-transition"
            enterFrom="ui-transition--lifted"
            enterTo="ui-transition--visible"
            leave="ui-transition"
            leaveFrom="ui-transition--visible"
            leaveTo="ui-transition--lifted"
            show={open}
          >
            <BasePopover.Popup className="ui-popover-popup">
              <div className="ui-popover-heading">
                <BasePopover.Title className="ui-popover-title">
                  {title}
                </BasePopover.Title>
                <BasePopover.Close
                  aria-label="Close popover"
                  className="ui-popup-close"
                >
                  <svg aria-hidden="true" viewBox="0 0 20 20">
                    <path d="M5 5l10 10M15 5L5 15" />
                  </svg>
                </BasePopover.Close>
              </div>
              {children}
              <BasePopover.Arrow className="ui-popover-arrow" />
            </BasePopover.Popup>
          </Transition>
        </BasePopover.Positioner>
      </BasePopover.Portal>
    </BasePopover.Root>
  );
};
