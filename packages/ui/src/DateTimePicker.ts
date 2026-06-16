import DateTimePickerBase from '@expo/ui/community/datetime-picker';
import { styled } from 'nativewind';

export type {
  DateTimePickerChangeEvent,
  DateTimePickerEvent,
  DateTimePickerProps,
} from '@expo/ui/community/datetime-picker';

export const DateTimePicker = styled(DateTimePickerBase, {
  className: { target: 'style' },
});
