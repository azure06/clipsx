import { Component, type ReactNode, type ErrorInfo } from 'react'
import { Translation } from 'react-i18next'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <Translation>
            {t => (
              <div style={{ padding: '20px', textAlign: 'center' }}>
                <h1>{t('errors.genericTitle')}</h1>
                <p>{t('errors.genericDescription')}</p>
                <button onClick={() => this.setState({ hasError: false, error: null })}>
                  {t('common.retry')}
                </button>
              </div>
            )}
          </Translation>
        )
      )
    }

    return this.props.children
  }
}
