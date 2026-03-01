import type { ReactNode } from 'react'

type CardVariant = 'default' | 'outlined' | 'elevated'

export type CardProps = {
  readonly children: ReactNode
  readonly header?: ReactNode
  readonly footer?: ReactNode
  readonly onClick?: () => void
  readonly variant?: CardVariant
  readonly className?: string
}

const variantClasses: Record<CardVariant, string> = {
  default: 'bg-slate-100/40 dark:bg-slate-900/40',
  outlined: 'bg-transparent border-2 border-gray-300 dark:border-gray-700',
  elevated: 'bg-slate-200/40 dark:bg-slate-900 shadow-lg',
}

export const Card = ({
  children,
  header,
  footer,
  onClick,
  variant = 'default',
  className = '',
}: CardProps) => {
  const baseClasses = 'rounded-xl overflow-hidden'
  const interactiveClasses = onClick
    ? 'cursor-pointer transition-all hover:scale-[1.02] hover:shadow-md'
    : ''

  const classes = `${baseClasses} ${variantClasses[variant]} ${interactiveClasses} ${className}`

  return (
    <div className={classes} onClick={onClick}>
      {header && (
        <div className="border-b border-gray-200 dark:border-gray-800 bg-slate-100/30 dark:bg-slate-900/50 px-5 py-4">
          {header}
        </div>
      )}

      <div className="p-5">{children}</div>

      {footer && (
        <div className="border-t border-gray-200 dark:border-gray-800 bg-slate-100/30 dark:bg-slate-900/50 px-5 py-4">
          {footer}
        </div>
      )}
    </div>
  )
}
