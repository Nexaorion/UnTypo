import FormLabel from '@mui/material/FormLabel';
import Stack from '@mui/material/Stack';
import TextField, { type TextFieldProps } from '@mui/material/TextField';
import { useId } from 'react';

export type FieldProps = Omit<TextFieldProps, 'label' | 'variant'> & {
  label: string;
};

export const Field = ({ id, label, slotProps, ...rest }: FieldProps) => {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const labelId = `${inputId}-label`;

  return (
    <Stack sx={{ gap: 0.75, minWidth: 0, width: '100%' }}>
      <FormLabel error={rest.error} htmlFor={inputId} id={labelId}>
        {label}
      </FormLabel>
      <TextField
        fullWidth
        id={inputId}
        // Select renders a div[role=combobox], which label/for cannot address.
        slotProps={
          rest.select ? { ...slotProps, select: { labelId } } : slotProps
        }
        {...rest}
      />
    </Stack>
  );
};
