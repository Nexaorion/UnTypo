import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip';
import type { ReactElement, ReactNode } from 'react';

export interface TooltipProps {
  children: ReactElement;
  label: ReactNode;
}

export const TooltipProvider = ({ children }: { children: ReactNode }) => (
  <BaseTooltip.Provider delay={350}>{children}</BaseTooltip.Provider>
);

export const Tooltip = ({ children, label }: TooltipProps) => (
  <BaseTooltip.Root>
    <BaseTooltip.Trigger render={children} />
    <BaseTooltip.Portal>
      <BaseTooltip.Positioner sideOffset={8}>
        <BaseTooltip.Popup className="ui-tooltip-popup">
          {label}
          <BaseTooltip.Arrow className="ui-tooltip-arrow" />
        </BaseTooltip.Popup>
      </BaseTooltip.Positioner>
    </BaseTooltip.Portal>
  </BaseTooltip.Root>
);
