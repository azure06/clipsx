import { LockKeyhole, Mail } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { DesktopAuthProvider } from '../../../shared/auth/supabaseAuth'
import type { AuthStatus } from '../../../stores/authStore'

type AccountSignInOptionsProps = {
  readonly status: AuthStatus
  readonly signingInProvider: DesktopAuthProvider | null
  readonly onSignIn: (provider: DesktopAuthProvider) => void
}

const GoogleIcon = () => (
  <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24">
    <path
      fill="#4285F4"
      d="M21.6 12.23c0-.71-.06-1.4-.19-2.07H12v3.92h5.38a4.6 4.6 0 0 1-2 3.02v2.54h3.24c1.9-1.75 2.98-4.32 2.98-7.41Z"
    />
    <path
      fill="#34A853"
      d="M12 22c2.7 0 4.98-.9 6.63-2.36l-3.24-2.54c-.9.6-2.05.96-3.39.96-2.61 0-4.82-1.77-5.61-4.14H3.04v2.62A10 10 0 0 0 12 22Z"
    />
    <path
      fill="#FBBC05"
      d="M6.39 13.92A6.02 6.02 0 0 1 6.07 12c0-.67.12-1.32.32-1.92V7.46H3.04A10 10 0 0 0 2 12c0 1.62.39 3.15 1.04 4.54l3.35-2.62Z"
    />
    <path
      fill="#EA4335"
      d="M12 5.94c1.47 0 2.78.5 3.82 1.49l2.87-2.87A9.62 9.62 0 0 0 12 2a10 10 0 0 0-8.96 5.46l3.35 2.62C7.18 7.71 9.39 5.94 12 5.94Z"
    />
  </svg>
)

const GitHubIcon = () => (
  <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2C6.48 2 2 6.58 2 12.23c0 4.52 2.87 8.35 6.84 9.71.5.1.68-.22.68-.49 0-.24-.01-1.05-.02-1.9-2.78.62-3.37-1.21-3.37-1.21-.45-1.18-1.11-1.49-1.11-1.49-.91-.64.07-.62.07-.62 1 .07 1.53 1.05 1.53 1.05.89 1.57 2.34 1.11 2.91.85.09-.66.35-1.11.64-1.37-2.22-.26-4.56-1.14-4.56-5.06 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05A9.3 9.3 0 0 1 12 6.94a9.3 9.3 0 0 1 2.5.35c1.91-1.33 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.93-2.34 4.8-4.57 5.05.36.32.68.95.68 1.92 0 1.38-.01 2.5-.01 2.84 0 .27.18.59.69.49A10.21 10.21 0 0 0 22 12.23C22 6.58 17.52 2 12 2Z" />
  </svg>
)

const providers: Array<{
  id: DesktopAuthProvider
  icon: React.ReactNode
  labelKey: 'settings.continueWithGoogle' | 'settings.continueWithGitHub'
}> = [
  { id: 'google', icon: <GoogleIcon />, labelKey: 'settings.continueWithGoogle' },
  { id: 'github', icon: <GitHubIcon />, labelKey: 'settings.continueWithGitHub' },
]

export const AccountSignInOptions = ({
  status,
  signingInProvider,
  onSignIn,
}: AccountSignInOptionsProps) => {
  const { t } = useTranslation()
  const isSigningIn = status === 'signing_in'

  return (
    <div className="space-y-3">
      <div className="grid gap-2.5 sm:grid-cols-2">
        {providers.map(provider => {
          const isActive = isSigningIn && signingInProvider === provider.id
          return (
            <button
              key={provider.id}
              type="button"
              disabled={isSigningIn}
              aria-label={t(provider.labelKey)}
              onClick={() => onSignIn(provider.id)}
              className="group flex min-h-14 items-center gap-3 rounded-xl border border-slate-200/90 bg-white/80 px-4 text-left text-sm font-semibold text-slate-800 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-[border-color,background-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-violet-300 hover:bg-white hover:shadow-[0_8px_20px_rgba(76,29,149,0.08)] focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/60 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-55 dark:border-white/10 dark:bg-white/[0.045] dark:text-slate-100 dark:hover:border-violet-400/40 dark:hover:bg-white/[0.07]"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200/80 bg-white text-slate-900 shadow-sm dark:border-white/10 dark:bg-slate-950 dark:text-white">
                {isActive ? (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-violet-500 border-r-transparent" />
                ) : (
                  provider.icon
                )}
              </span>
              <span>{isActive ? t('settings.openingProvider') : t(provider.labelKey)}</span>
            </button>
          )
        })}
      </div>

      <div
        aria-disabled="true"
        className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-slate-200/90 bg-slate-50/55 px-4 py-3 text-slate-400 dark:border-white/10 dark:bg-white/[0.018] dark:text-slate-500"
      >
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-200/60 dark:bg-white/5">
            <Mail className="h-4 w-4" />
          </span>
          <div>
            <p className="text-sm font-medium">{t('settings.emailPassword')}</p>
            <p className="text-xs">{t('settings.comingLater')}</p>
          </div>
        </div>
        <LockKeyhole className="h-4 w-4 shrink-0" />
      </div>
    </div>
  )
}
