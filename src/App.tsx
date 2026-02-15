import { useWindowBehavior } from './shared/hooks/useWindowBehavior'
import { ErrorBoundary } from './shared/components/ErrorBoundary'
import { ThemeProvider } from './shared/hooks/useTheme'
import { SemanticLayout } from './features/hub/layout/SemanticLayout'

const App = () => {
  useWindowBehavior()

  return (
    <ThemeProvider>
      <ErrorBoundary>
        <SemanticLayout />
      </ErrorBoundary>
    </ThemeProvider>
  )
}

export default App
