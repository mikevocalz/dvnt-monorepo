import * as React from 'react'
import { Input } from '@/components/ui'
import type { InputProps } from '@/components/ui'

export function FormInput<TValues extends Record<string, any>>({
  form,
  name,
  validators,
  ...props
}: {
  form: any
  name: keyof TValues & string
  validators?: any
} & Omit<InputProps, 'value' | 'onChangeText' | 'onBlur' | 'error'>) {
  return (
    <form.Field name={name} validators={validators}>
      {(field: any) => (
        <Input
          {...props}
          value={field.state.value}
          onChangeText={field.handleChange}
          onBlur={field.handleBlur}
          error={field.state.meta.errors?.[0]}
        />
      )}
    </form.Field>
  )
}
