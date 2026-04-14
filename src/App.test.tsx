import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import App from './App'

vi.mock('./shared/hooks/useWindowBehavior', () => ({
  useWindowBehavior: vi.fn(),
}))

vi.mock('./features/app/AppLayout', () => ({
  AppLayout: () => <div>Mock App Layout</div>,
}))

describe('App', () => {
  it('renders the application shell', () => {
    render(<App />)
    expect(screen.getByText('Mock App Layout')).toBeInTheDocument()
  })
})
