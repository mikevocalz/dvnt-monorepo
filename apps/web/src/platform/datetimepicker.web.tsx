'use client';

import React, { useMemo } from 'react';

type DateTimePickerProps = {
  value?: Date;
  mode?: 'date' | 'time' | 'datetime' | 'countdown';
  display?: string;
  minimumDate?: Date;
  maximumDate?: Date;
  disabled?: boolean;
  style?: React.CSSProperties;
  onChange?: (event: unknown, date?: Date) => void;
};

function pad(value: number) {
  return String(value).padStart(2, '0');
}

function formatDateInput(value: Date, mode: DateTimePickerProps['mode']) {
  const year = value.getFullYear();
  const month = pad(value.getMonth() + 1);
  const day = pad(value.getDate());
  const hours = pad(value.getHours());
  const minutes = pad(value.getMinutes());

  if (mode === 'time' || mode === 'countdown') {
    return `${hours}:${minutes}`;
  }

  if (mode === 'datetime') {
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  }

  return `${year}-${month}-${day}`;
}

function parseDateInput(rawValue: string, mode: DateTimePickerProps['mode'], fallback: Date) {
  if (!rawValue) return fallback;

  if (mode === 'time' || mode === 'countdown') {
    const [hours, minutes] = rawValue.split(':').map(Number);
    const next = new Date(fallback);
    next.setHours(hours || 0, minutes || 0, 0, 0);
    return next;
  }

  return new Date(rawValue);
}

export default function DateTimePicker({
  value = new Date(),
  mode = 'date',
  minimumDate,
  maximumDate,
  disabled,
  style,
  onChange,
}: DateTimePickerProps) {
  const inputType = mode === 'time' || mode === 'countdown' ? 'time' : mode === 'datetime' ? 'datetime-local' : 'date';
  const normalizedValue = useMemo(() => formatDateInput(value, mode), [mode, value]);

  return (
    <input
      disabled={disabled}
      max={maximumDate ? formatDateInput(maximumDate, mode) : undefined}
      min={minimumDate ? formatDateInput(minimumDate, mode) : undefined}
      onChange={(event) => {
        const nextDate = parseDateInput(event.currentTarget.value, mode, value);
        onChange?.(
          {
            type: 'set',
            nativeEvent: {
              timestamp: nextDate.getTime(),
              utcOffset: -nextDate.getTimezoneOffset(),
            },
          },
          nextDate,
        );
      }}
      style={{
        colorScheme: 'dark',
        font: 'inherit',
        ...style,
      }}
      type={inputType}
      value={normalizedValue}
    />
  );
}
