import FormControlLabel from '@mui/material/FormControlLabel';
import FormHelperText from '@mui/material/FormHelperText';
import Switch from '@mui/material/Switch';
import { useId } from 'react';

export interface SwitchFieldProps {
  checked: boolean;
  description?: string;
  disabled?: boolean;
  label: string;
  onCheckedChange: (checked: boolean) => void;
  testId?: string;
}

export const SwitchField = ({
  checked,
  description,
  disabled,
  label,
  onCheckedChange,
  testId,
}: SwitchFieldProps) => {
  const descriptionId = useId();

  return (
    <div>
      <FormControlLabel
        control={
          <Switch
            checked={checked}
            data-testid={testId}
            disabled={disabled}
            onChange={(event) => onCheckedChange(event.target.checked)}
            // MUI renders a checkbox input; role=switch announces on/off instead of checked.
            slotProps={{
              input: {
                'aria-describedby': description ? descriptionId : undefined,
                role: 'switch',
              },
            }}
          />
        }
        label={label}
        slotProps={{ typography: { sx: { fontSize: 13, fontWeight: 500 } } }}
        sx={{ justifyContent: 'space-between', ml: 0, width: '100%' }}
        labelPlacement="start"
      />
      {description ? (
        <FormHelperText id={descriptionId}>{description}</FormHelperText>
      ) : null}
    </div>
  );
};
