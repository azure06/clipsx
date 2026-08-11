import * as SwitchPrimitive from '@radix-ui/react-switch'

type SwitchSize = 'sm' | 'md'

export type SwitchProps = {
  readonly checked: boolean
  readonly onChange: (checked: boolean) => void
  readonly label?: string
  readonly disabled?: boolean
  readonly size?: SwitchSize
  readonly className?: string
}

const sizeClasses: Record<SwitchSize, { root: string; thumb: string }> = {
  sm: {
    root: 'h-5 w-9',
    thumb: 'h-3 w-3 data-[state=checked]:translate-x-5',
  },
  md: {
    root: 'h-6 w-11',
    thumb: 'h-4 w-4 data-[state=checked]:translate-x-6',
  },
}

export const Switch = ({
  checked,
  onChange,
  label,
  disabled = false,
  size = 'md',
  className = '',
}: SwitchProps) => {
  const { root, thumb } = sizeClasses[size]

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <SwitchPrimitive.Root
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
        className={`${root} relative inline-flex items-center rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-900 data-[state=checked]:bg-linear-to-r data-[state=checked]:from-blue-500 data-[state=checked]:to-violet-500 data-[state=unchecked]:bg-slate-300 dark:data-[state=unchecked]:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer hover:data-[state=unchecked]:bg-slate-400 dark:hover:data-[state=unchecked]:bg-slate-600`}
      >
        <SwitchPrimitive.Thumb
          className={`${thumb} block rounded-full bg-slate-100 shadow-sm transition-transform duration-200 translate-x-1`}
        />
      </SwitchPrimitive.Root>
      {label && (
        <label className="text-sm font-medium text-gray-900 dark:text-gray-100 cursor-pointer">
          {label}
        </label>
      )}
    </div>
  )
}
