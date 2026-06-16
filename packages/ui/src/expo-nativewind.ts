import { styled } from 'nativewind';
import {
  Button as ExpoButton,
  Column as ExpoColumn,
  Row as ExpoRow,
  Text as ExpoText,
  TextInput as ExpoTextInput,
} from '@expo/ui';

export const NativeWindExpoButton = styled(ExpoButton, {
  className: { target: 'style' },
});

export const NativeWindExpoColumn = styled(ExpoColumn, {
  className: { target: 'style' },
});

export const NativeWindExpoRow = styled(ExpoRow, {
  className: { target: 'style' },
});

export const NativeWindExpoText = styled(ExpoText, {
  className: { target: 'textStyle' },
});

export const NativeWindExpoTextInput = styled(ExpoTextInput, {
  className: { target: 'style' },
  textClassName: { target: 'textStyle' },
});
