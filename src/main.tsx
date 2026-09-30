import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'
import './i18n'
import { bootstrapTelemetry, reactErrorHandler } from './shared/telemetry'

void bootstrapTelemetry().then(() =>
  ReactDOM.createRoot(document.getElementById('root')!, {
    onUncaughtError: reactErrorHandler(),
    onRecoverableError: reactErrorHandler(),
  }).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
)
