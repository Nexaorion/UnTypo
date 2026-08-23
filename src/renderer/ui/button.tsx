import { Button as BaseButton } from '@base-ui/react/button';
import type { ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps extends Omit<
  BaseButton.Props,
  'children' | 'className'
> {
  children?: ReactNode;
  className?: string;
  variant?: ButtonVariant;
}

export const Button = ({
  children,
  className = '',
  variant = 'secondary',
  ...props
}: ButtonProps) => (
  <BaseButton
    className={`ui-button ui-button--${variant} ${className}`.trim()}
    {...props}
  >
    {children}
  </BaseButton>
);
