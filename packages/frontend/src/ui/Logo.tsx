import { Link } from 'react-router-dom'
import { cn } from './cn'

type LogoProps = {
  className?: string
  markClassName?: string
  showText?: boolean
}

export function Logo({ className, markClassName, showText = true }: LogoProps): JSX.Element {
  return (
    <Link to="/" className={cn('inline-flex items-center gap-3', className)}>
      <img
        src="/brand/orquestra-v07/1-app-icon.svg"
        alt="Orquestra"
        className={cn('h-10 w-10 object-cover shadow-[0_8px_24px_rgba(31,30,28,0.12)]', markClassName)}
      />
      {showText ? <span className="text-base font-medium tracking-tight text-ink">Orquestra</span> : null}
    </Link>
  )
}
