import { Switch as BaseSwitch } from '@base-ui/react/switch';

export interface SwitchProps extends Omit<
  BaseSwitch.Root.Props,
  'children' | 'className'
> {
  description?: string;
  label: string;
}

export const Switch = ({ description, label, ...props }: SwitchProps) => (
  <label className="ui-switch-row">
    <span className="ui-switch-copy">
      <strong>{label}</strong>
      {description ? <small>{description}</small> : null}
    </span>
    <BaseSwitch.Root className="ui-switch" {...props}>
      <BaseSwitch.Thumb className="ui-switch__thumb" />
    </BaseSwitch.Root>
  </label>
);
