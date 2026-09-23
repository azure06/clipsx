import { diagnostic } from '../diagnostics'
import { Component, type ReactNode } from 'react'
import { Translation } from 'react-i18next'
import { captureBoundaryError } from '../telemetry'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
  eventId: string | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null, eventId: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, eventId: null }
  }

  componentDidCatch(error: Error) {
    diagnostic('errorboundary_caught_an_error')
    this.setState({ eventId: captureBoundaryError(error) })
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
                {this.state.eventId && <p className="text-xs">Reference: {this.state.eventId}</p>}
                <button
                  onClick={() => this.setState({ hasError: false, error: null, eventId: null })}
                >
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
