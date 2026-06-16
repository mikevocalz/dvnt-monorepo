import * as React from 'react'
import { cn } from '../../lib/cn'

interface SwitchProps {
  checked?: boolean
  onCheckedChange?: (checked: boolean) => void
  disabled?: boolean
  className?: string
}

function Switch({ checked = false, onCheckedChange, disabled = false, className }: SwitchProps) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onCheckedChange?.(!checked)}
      className={cn(
        'peer inline-flex h-[1.15rem] w-8 shrink-0 cursor-pointer items-center rounded-full border border-transparent shadow-sm transition-all outline-none',
        'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
        'disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-primary' : 'bg-input dark:bg-input/80',
        className,
      )}
    >
      <span
        className={cn(
          'bg-background pointer-events-none block size-4 rounded-full ring-0 transition-transform',
          checked ? 'translate-x-3.5 dark:bg-primary-foreground' : 'translate-x-0 dark:bg-foreground',
        )}
      />
    </button>
  )
}

export { Switch }
export type { SwitchProps }
