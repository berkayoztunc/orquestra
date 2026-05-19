import type { HTMLAttributes } from 'react'
import { cn } from './cn'

type BadgeTone = 'default' | 'ink' | 'stone' | 'success' | 'danger'

const toneClasses: Record<BadgeTone, string> = {
  default: 'border-border-low bg-sand-100 text-sand-1200',
  ink: 'border-sand-1600 bg-sand-1600 text-bg1',
  stone: 'border-border-medium bg-sand-100 text-sand-1500',
  success: 'border-sand-700/40 bg-sand-200 text-sand-1500',
  danger: 'border-[#b75000]/30 bg-[#b75000]/10 text-[#b75000]',
}

export function Badge({
  className,
  tone = 'default',
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }): JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center border px-2.5 py-0.5 font-mono text-[11px] uppercase tracking-[0.08em]',
        toneClasses[tone],
        className,
      )}
      {...props}
    />
  )
}
