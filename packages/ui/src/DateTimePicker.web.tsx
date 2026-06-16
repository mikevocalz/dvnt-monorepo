import type { CSSProperties } from 'react';
import type {
  DateTimePickerChangeEvent,
  DateTimePickerEvent,
  DateTimePickerProps as ExpoDateTimePickerProps,
} from '@expo/ui/community/datetime-picker';

export type DateTimePickerProps = ExpoDateTimePickerProps & {
  className?: string;
};

export type { DateTimePickerChangeEvent, DateTimePickerEvent };

function pad(value: number) {
  return String(value).padStart(2, '0');
}

function toInputValue(date: Date, mode: DateTimePickerProps['mode']) {
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());

  if (mode === 'time') {
    return `${hours}:${minutes}`;
  }

  if (mode === 'datetime') {
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  }

  return `${year}-${month}-${day}`;
}

function fromInputValue(inputValue: string, currentDate: Date, mode: DateTimePickerProps['mode']) {
  if (mode === 'time') {
    const [hours = '0', minutes = '0'] = inputValue.split(':');
    const nextDate = new Date(currentDate);
    nextDate.setHours(Number(hours), Number(minutes), 0, 0);
    return nextDate;
  }

  if (mode === 'datetime') {
    return new Date(inputValue);
  }

  const [year = '1970', month = '1', day = '1'] = inputValue.split('-');
  const nextDate = new Date(currentDate);
  nextDate.setFullYear(Number(year), Number(month) - 1, Number(day));
  nextDate.setHours(0, 0, 0, 0);
  return nextDate;
}

function buildChangeEvent(date: Date): DateTimePickerChangeEvent {
  return {
    nativeEvent: {
      timestamp: date.getTime(),
      utcOffset: -date.getTimezoneOffset(),
    },
  };
}

function buildEvent(date: Date): DateTimePickerEvent {
  return {
    type: 'set',
    nativeEvent: buildChangeEvent(date).nativeEvent,
  };
}

export function DateTimePicker({
  value,
  onChange,
  onValueChange,
  mode = 'date',
  minimumDate,
  maximumDate,
  disabled,
  style,
  className,
  testID,
}: DateTimePickerProps) {
  const inputType = mode === 'time' ? 'time' : mode === 'datetime' ? 'datetime-local' : 'date';

  return (
    <input
      className={className}
      data-testid={testID}
      disabled={disabled}
      max={maximumDate ? toInputValue(maximumDate, mode) : undefined}
      min={minimumDate ? toInputValue(minimumDate, mode) : undefined}
      onChange={(event) => {
        if (!event.currentTarget.value) {
          return;
        }

        const nextDate = fromInputValue(event.currentTarget.value, value, mode);
        if (Number.isNaN(nextDate.getTime())) {
          return;
        }

        if (onValueChange) {
          onValueChange(buildChangeEvent(nextDate), nextDate);
        } else {
          onChange?.(buildEvent(nextDate), nextDate);
        }
      }}
      style={style as CSSProperties}
      type={inputType}
      value={toInputValue(value, mode)}
    />
  );
}
