import FormControlLabel from '@mui/material/FormControlLabel';
import FormHelperText from '@mui/material/FormHelperText';
import Switch from '@mui/material/Switch';
import { useId } from 'react';

export interface SwitchFieldProps {
  checked: boolean;
  description?: string;
  label: string;
  onCheckedChange: (checked: boolean) => void;
}

export const SwitchField = ({
  checked,
  description,
  label,
  onCheckedChange,
}: SwitchFieldProps) => {
  const descriptionId = useId();

  return (
    <div>
      <FormControlLabel
        control={
          <Switch
            checked={checked}
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
