import type { HTMLAttributes } from 'react'
import { cn } from './cn'

export function CodePanel({ className, ...props }: HTMLAttributes<HTMLDivElement>): JSX.Element {
  return (
    <div
      className={cn(
        'overflow-hidden border border-line bg-ink text-ivory shadow-[0_12px_40px_rgba(31,30,28,0.10)]',
        className,
      )}
      {...props}
    />
  )
}
