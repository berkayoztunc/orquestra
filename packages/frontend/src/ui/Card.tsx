import type { HTMLAttributes } from 'react'
import { cn } from './cn'

type CardProps = HTMLAttributes<HTMLDivElement> & {
  interactive?: boolean
  tone?: 'default' | 'sand' | 'cream'
}

const toneClass: Record<NonNullable<CardProps['tone']>, string> = {
  default: 'bg-bg1',
  sand: 'bg-sand-100',
  cream: 'bg-cream',
}

export function Card({ className, interactive = false, tone = 'default', ...props }: CardProps): JSX.Element {
  return (
    <div
      className={cn(
        ' border border-border-low',
        toneClass[tone],
        interactive && 'transition-colors duration-150 hover:border-border-medium hover:bg-sand-100',
        className,
      )}
      {...props}
    />
  )
}
