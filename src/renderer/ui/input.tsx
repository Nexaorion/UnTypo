import { Input as BaseInput } from '@base-ui/react/input';

export interface InputProps extends Omit<BaseInput.Props, 'className'> {
  className?: string;
}

export const Input = ({ className = '', ...props }: InputProps) => (
  <BaseInput className={`ui-input ${className}`.trim()} {...props} />
);
