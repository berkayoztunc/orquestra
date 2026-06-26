import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { cn } from './cn'

const fieldClassName =
  'w-full border border-line bg-paper px-3.5 py-2.5 text-sm text-ink placeholder:text-muted-ink/60 transition-colors duration-150 focus:border-taupe focus:outline-none focus:ring-2 focus:ring-taupe/25 disabled:cursor-not-allowed disabled:opacity-60'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return <input ref={ref} className={cn(fieldClassName, className)} {...props} />
})

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...props },
  ref,
) {
  return <textarea ref={ref} className={cn(fieldClassName, 'min-h-28 resize-y', className)} {...props} />
})
