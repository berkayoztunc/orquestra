import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from 'react'
import { cn } from './cn'

type ButtonVariant = 'primary' | 'secondary' | 'ghost'
type ButtonSize = 'sm' | 'md' | 'lg'

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'border-sand-1600 bg-sand-1600 text-bg1 hover:bg-sand-1400 hover:border-sand-1400',
  secondary: 'border-border-medium bg-bg1 text-sand-1500 hover:border-border-strong hover:bg-sand-100',
  ghost: 'border-transparent bg-transparent text-sand-1200 hover:bg-sand-100 hover:text-sand-1600',
}

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'min-h-9 px-3 py-1.5 text-xs',
  md: 'min-h-10 px-4 py-2 text-sm',
  lg: 'min-h-11 px-5 py-2.5 text-sm',
}

export function buttonClassName({
  variant = 'primary',
  size = 'md',
  className,
}: {
  variant?: ButtonVariant
  size?: ButtonSize
  className?: string
} = {}): string {
  return cn(
    'inline-flex items-center justify-center gap-2 border font-medium transition-colors duration-150',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sand-400 focus-visible:ring-offset-2 focus-visible:ring-offset-bg1',
    'disabled:pointer-events-none disabled:opacity-50',
    variantClasses[variant],
    sizeClasses[size],
    className,
  )
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
}

export function Button({ variant = 'primary', size = 'md', className, type = 'button', ...props }: ButtonProps): JSX.Element {
  return <button type={type} className={buttonClassName({ variant, size, className })} {...props} />
}

type AnchorButtonProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
}

export function AnchorButton({ variant = 'primary', size = 'md', className, ...props }: AnchorButtonProps): JSX.Element {
  return <a className={buttonClassName({ variant, size, className })} {...props} />
}
