import type { ReactNode } from 'react';
import { Button, type ButtonVariant } from './button';

export interface IconButtonProps {
  'aria-label': string;
  children: ReactNode;
  onClick?: () => void;
  variant?: ButtonVariant;
}

export const IconButton = ({
  children,
  variant = 'ghost',
  ...props
}: IconButtonProps) => (
  <Button className="ui-icon-button" variant={variant} {...props}>
    {children}
  </Button>
);
