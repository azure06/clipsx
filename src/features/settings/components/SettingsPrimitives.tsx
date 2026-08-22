import type { ReactNode } from 'react'
import { Button, Card } from '../../../shared/components/ui'

type SettingsSectionProps = {
  readonly icon: ReactNode
  readonly title: string
  readonly description: string
  readonly children: ReactNode
}

export const SettingsSection = ({ icon, title, description, children }: SettingsSectionProps) => (
  <Card
    header={
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-linear-to-br from-violet-500/12 to-fuchsia-500/8 text-violet-700 dark:text-violet-300">
          {icon}
        </div>
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
          <p className="text-xs text-slate-500">{description}</p>
        </div>
      </div>
    }
    className="border border-slate-200/70 bg-white/35 shadow-[0_6px_18px_rgba(15,23,42,0.04)] dark:border-white/10 dark:bg-white/[0.025] dark:shadow-none"
  >
    <div className="space-y-4">{children}</div>
  </Card>
)

type SettingRowProps = {
  readonly label: string
  readonly description?: string
  readonly children: ReactNode
}

export const SettingRow = ({ label, description, children }: SettingRowProps) => (
  <div className="flex items-start justify-between gap-4">
    <div className="min-w-0 flex-1">
      <label className="text-sm font-medium text-slate-900 dark:text-slate-100">{label}</label>
      {description && <p className="mt-0.5 text-xs text-slate-500">{description}</p>}
    </div>
    <div className="shrink-0">{children}</div>
  </div>
)

type ButtonGroupOption = {
  readonly value: number
  readonly label: string
  readonly icon?: ReactNode
}

type ButtonGroupProps = {
  readonly value: number
  readonly onChange: (value: number) => void
  readonly options: readonly ButtonGroupOption[]
}

export const ButtonGroup = ({ value, onChange, options }: ButtonGroupProps) => (
  <div className="flex flex-wrap gap-2">
    {options.map(option => (
      <Button
        key={option.value}
        variant={value === option.value ? 'primary' : 'secondary'}
        size="sm"
        onClick={() => onChange(option.value)}
        leftIcon={option.icon}
      >
        {option.label}
      </Button>
    ))}
  </div>
)
