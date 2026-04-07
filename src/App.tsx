import { useWindowBehavior } from './shared/hooks/useWindowBehavior'
import { ErrorBoundary } from './shared/components/ErrorBoundary'
import { ThemeProvider } from './shared/hooks/useTheme'
import { AppLayout } from './features/app/AppLayout'
import { ToastProvider } from './shared/contexts/ToastContext'

const App = () => {
  useWindowBehavior()

  return (
    <ThemeProvider>
      <ErrorBoundary>
        <ToastProvider>
          <AppLayout />
        </ToastProvider>
      </ErrorBoundary>
    </ThemeProvider>
  )
}

export default App
