import FormHelperText from '@mui/material/FormHelperText';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
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
  const labelId = useId();

  return (
    <div>
      <Stack
        direction="row"
        sx={{ alignItems: 'center', gap: 2, justifyContent: 'space-between' }}
      >
        <Typography
          data-testid={testId ? `${testId}-label` : undefined}
          id={labelId}
          sx={{ fontSize: 13, fontWeight: 500 }}
        >
          {label}
        </Typography>
        <Switch
          checked={checked}
          data-testid={testId}
          disabled={disabled}
          onChange={(event) => onCheckedChange(event.target.checked)}
          // MUI renders a checkbox input; role=switch announces on/off instead of checked.
          slotProps={{
            input: {
              'aria-describedby': description ? descriptionId : undefined,
              'aria-labelledby': labelId,
              role: 'switch',
            },
          }}
        />
      </Stack>
      {description ? (
        <FormHelperText id={descriptionId}>{description}</FormHelperText>
      ) : null}
    </div>
  );
};
