import { Eye, Columns2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
export function ResultViewToggle({
  mode,
  onChange,
}: {
  mode: 'preview' | 'compare'
  onChange: (mode: 'preview' | 'compare') => void
}) {
  const { t } = useTranslation()
  return (
    <div className="result-view-toggle">
      <div
        role="group"
        aria-label={t('resultWorkspace.viewMode')}
        className="flex items-center gap-0.5 rounded-lg border border-slate-200/70 bg-slate-100/60 p-0.5 dark:border-white/10 dark:bg-black/15"
      >
        {(['preview', 'compare'] as const).map(value => {
          const Icon = value === 'preview' ? Eye : Columns2
          const label = t(value === 'preview' ? 'resultWorkspace.preview' : 'desktopUi.compare')
          return (
            <button
              key={value}
              type="button"
              aria-label={label}
              title={label}
              aria-pressed={mode === value}
              onClick={() => onChange(value)}
              className={`flex items-center justify-center gap-1 whitespace-nowrap rounded-md px-1.5 py-1.5 text-[11px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-violet-500 motion-safe:transition-[color,background-color,box-shadow] ${mode === value ? 'bg-white text-violet-700 shadow-sm dark:bg-slate-700/70 dark:text-violet-200' : 'text-slate-500 hover:bg-white/60 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-slate-200'}`}
            >
              <Icon aria-hidden="true" size={13} />
              <span className="result-mode-label">{label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
