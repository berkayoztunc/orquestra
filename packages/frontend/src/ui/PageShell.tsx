import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from './cn'

type PageShellProps = HTMLAttributes<HTMLDivElement> & {
  eyebrow?: string
  title?: ReactNode
  description?: ReactNode
  actions?: ReactNode
}

export function PageShell({ eyebrow, title, description, actions, className, children, ...props }: PageShellProps): JSX.Element {
  return (
    <div className={cn('space-y-8', className)} {...props}>
      {(eyebrow || title || description || actions) && (
        <header className="grid gap-5 border-b border-line pb-8 lg:grid-cols-[1fr_auto] lg:items-end">
          <div className="max-w-3xl">
            {eyebrow ? <p className="text-xs font-medium uppercase tracking-[0.24em] text-muted-ink">{eyebrow}</p> : null}
            {title ? <h1 className="mt-3 text-balance text-4xl font-medium leading-[1.02] tracking-[-0.02em] text-ink md:text-6xl">{title}</h1> : null}
            {description ? <p className="mt-4 max-w-2xl text-base leading-7 text-muted-ink">{description}</p> : null}
          </div>
          {actions ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
        </header>
      )}
      {children}
    </div>
  )
}
