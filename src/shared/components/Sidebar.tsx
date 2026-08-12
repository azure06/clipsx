import { Blocks, CircleAlert, Layers, Loader2, Settings, Sparkles, User } from 'lucide-react'
import { useAuthStore, useUIStore } from '../../stores'
import { useTranslation } from 'react-i18next'

type SidebarProps = {
  onAccountClick: () => void
  onSettingsClick: () => void
}

export const Sidebar = ({ onAccountClick, onSettingsClick }: SidebarProps) => {
  const { t } = useTranslation()
  const { activeView, setActiveView } = useUIStore()
  const authStatus = useAuthStore(state => state.status)
  const authEmail = useAuthStore(state => state.email)

  const accountLabel = (() => {
    switch (authStatus) {
      case 'signed_in':
        return t('sidebar.accountSignedIn', { email: authEmail ?? '' })
      case 'loading':
        return t('sidebar.accountRestoring')
      case 'signing_in':
        return t('sidebar.accountSigningIn')
      case 'error':
        return t('sidebar.accountError')
      case 'unconfigured':
        return t('sidebar.accountUnavailable')
      default:
        return t('sidebar.accountSignedOut')
    }
  })()

  const accountIcon =
    authStatus === 'loading' || authStatus === 'signing_in' ? (
      <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} />
    ) : authStatus === 'error' ? (
      <CircleAlert className="h-3.5 w-3.5" strokeWidth={1.5} />
    ) : (
      <User className="h-3.5 w-3.5" strokeWidth={1.5} />
    )

  const statusColor =
    authStatus === 'signed_in'
      ? 'bg-emerald-500'
      : authStatus === 'error'
        ? 'bg-amber-500'
        : authStatus === 'unconfigured'
          ? 'bg-gray-400'
          : 'bg-gray-500'

  return (
    <div className="flex w-12 shrink-0 flex-col items-center py-3">
      {/* Top Icons */}
      <div className="flex flex-col items-center gap-1">
        <button
          onClick={() => setActiveView('clips')}
          className={`relative flex h-9 w-9 items-center justify-center rounded-lg transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-1 focus-visible:ring-offset-transparent ${
            activeView === 'clips'
              ? 'text-gray-900 dark:text-gray-100'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-300'
          }`}
          title={t('sidebar.clipboard')}
        >
          <Layers className="h-4 w-4" strokeWidth={1.5} />
          {activeView === 'clips' && (
            <div className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r bg-blue-500 dark:bg-slate-400" />
          )}
        </button>

        <button
          onClick={() => setActiveView('intelligence')}
          className={`relative flex h-9 w-9 items-center justify-center rounded-lg transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-1 focus-visible:ring-offset-transparent ${
            activeView === 'intelligence'
              ? 'text-gray-900 dark:text-gray-100'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-300'
          }`}
          title={t('sidebar.intelligence')}
        >
          <Sparkles className="h-4 w-4" strokeWidth={1.5} />
          {activeView === 'intelligence' && (
            <div className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r bg-blue-500 dark:bg-slate-400" />
          )}
        </button>

        <button
          onClick={() => setActiveView('extensions')}
          className={`relative flex h-9 w-9 items-center justify-center rounded-lg transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-1 focus-visible:ring-offset-transparent ${
            activeView === 'extensions'
              ? 'text-gray-900 dark:text-gray-100'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-300'
          }`}
          title={t('sidebar.extensions')}
        >
          <Blocks className="h-4 w-4" strokeWidth={1.5} />
          {activeView === 'extensions' && (
            <div className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r bg-blue-500 dark:bg-slate-400" />
          )}
        </button>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Bottom Icons */}
      <div className="flex flex-col items-center gap-1">
        <button
          onClick={onAccountClick}
          className="relative flex h-8 w-8 items-center justify-center rounded-lg text-gray-600 dark:text-gray-400 transition-colors cursor-pointer hover:bg-slate-200/50 dark:hover:bg-slate-800/50 hover:text-gray-800 dark:hover:text-gray-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-1 focus-visible:ring-offset-transparent"
          title={accountLabel}
          aria-label={accountLabel}
        >
          {accountIcon}
          <span
            aria-hidden="true"
            className={`absolute bottom-1 right-1 h-1.5 w-1.5 rounded-full ring-2 ring-slate-100/80 dark:ring-slate-950/80 ${statusColor}`}
          />
        </button>

        <button
          onClick={onSettingsClick}
          className={`relative flex h-9 w-9 items-center justify-center rounded-lg transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-1 focus-visible:ring-offset-transparent ${
            activeView === 'settings'
              ? 'text-gray-900 dark:text-gray-100'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-300'
          }`}
          title={t('sidebar.settings')}
        >
          <Settings className="h-4 w-4" strokeWidth={1.5} />
          {activeView === 'settings' && (
            <div className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r bg-blue-500 dark:bg-slate-400" />
          )}
        </button>
      </div>
    </div>
  )
}
