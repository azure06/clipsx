import type { ReactNode } from 'react'

type InputType = 'text' | 'number' | 'email' | 'password'

export type InputProps = {
  readonly type?: InputType
  readonly value: string
  readonly onChange: (value: string) => void
  readonly placeholder?: string
  readonly label?: string
  readonly error?: string
  readonly helperText?: string
  readonly disabled?: boolean
  readonly leftIcon?: ReactNode
  readonly rightIcon?: ReactNode
  readonly className?: string
}

export const Input = ({
  type = 'text',
  value,
  onChange,
  placeholder,
  label,
  error,
  helperText,
  disabled = false,
  leftIcon,
  rightIcon,
  className = '',
}: InputProps) => {
  const hasError = Boolean(error)
  
  return (
    <div className={`space-y-1 ${className}`}>
      {label && (
        <label className="block text-sm font-medium text-gray-900 dark:text-gray-100">
          {label}
        </label>
      )}
      
      <div className="relative">
        {leftIcon && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">
            {leftIcon}
          </div>
        )}
        
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          className={`w-full rounded-lg border bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:ring-2 disabled:opacity-50 disabled:cursor-not-allowed ${
            hasError
              ? 'border-red-300 dark:border-red-900 focus:border-red-500 focus:ring-red-500'
              : 'border-gray-300 dark:border-gray-700 focus:border-blue-500 focus:ring-blue-500'
          } ${leftIcon ? 'pl-10' : ''} ${rightIcon ? 'pr-10' : ''}`}
        />
        
        {rightIcon && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">
            {rightIcon}
          </div>
        )}
      </div>
      
      {(error || helperText) && (
        <p className={`text-xs ${hasError ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-gray-500'}`}>
          {error || helperText}
        </p>
      )}
    </div>
  )
}
