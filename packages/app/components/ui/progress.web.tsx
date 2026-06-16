import * as React from 'react'
import { cn } from '../../lib/cn'

interface ProgressProps {
  value?: number | null
  className?: string
  indicatorClassName?: string
}

function Progress({ value, className, indicatorClassName }: ProgressProps) {
  const pct = Math.min(100, Math.max(0, value ?? 0))
  return (
    <div
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn('bg-primary/20 relative h-2 w-full overflow-hidden rounded-full', className)}
    >
      <div
        className={cn('bg-primary h-full w-full flex-1 transition-all', indicatorClassName)}
        style={{ transform: `translateX(-${100 - pct}%)` }}
      />
    </div>
  )
}

export { Progress }
export type { ProgressProps }
