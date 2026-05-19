import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from './cn'

type SectionProps = HTMLAttributes<HTMLElement> & {
  eyebrow?: string
  title?: ReactNode
  description?: ReactNode
  align?: 'left' | 'center'
}

export function Section({
  eyebrow,
  title,
  description,
  align = 'left',
  className,
  children,
  ...props
}: SectionProps): JSX.Element {
  const isCenter = align === 'center'
  return (
    <section className={cn('space-y-10', className)} {...props}>
      {(eyebrow || title || description) && (
        <div className={cn('max-w-2xl', isCenter && 'mx-auto text-center')}>
          {eyebrow ? (
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-sand-1100">{eyebrow}</p>
          ) : null}
          {title ? (
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-sand-1600 md:text-4xl">
              {title}
            </h2>
          ) : null}
          {description ? (
            <p className="mt-4 text-base leading-7 text-sand-1200">{description}</p>
          ) : null}
        </div>
      )}
      {children}
    </section>
  )
}
