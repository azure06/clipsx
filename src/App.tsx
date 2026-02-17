import { useWindowBehavior } from './shared/hooks/useWindowBehavior'
import { ErrorBoundary } from './shared/components/ErrorBoundary'
import { ThemeProvider } from './shared/hooks/useTheme'
import { AppLayout } from './features/app/AppLayout'

const App = () => {
  useWindowBehavior()

  return (
    <ThemeProvider>
      <ErrorBoundary>
        <AppLayout />
      </ErrorBoundary>
    </ThemeProvider>
  )
}

export default App
