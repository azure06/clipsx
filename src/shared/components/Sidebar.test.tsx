import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Sidebar } from './Sidebar'
import { useAuthStore, useUIStore } from '../../stores'

describe('Sidebar account indicator', () => {
  const onAccountClick = vi.fn()
  const onSettingsClick = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    useAuthStore.setState({ status: 'signed_out', email: null, error: null })
    useUIStore.setState({ activeView: 'clips' })
  })

  it('shows the signed-in email and opens account settings', () => {
    useAuthStore.setState({ status: 'signed_in', email: 'user@example.com' })

    render(<Sidebar onAccountClick={onAccountClick} onSettingsClick={onSettingsClick} />)

    const accountButton = screen.getByRole('button', {
      name: 'Signed in as user@example.com',
    })
    expect(accountButton).toHaveAttribute('title', 'Signed in as user@example.com')

    fireEvent.click(accountButton)
    expect(onAccountClick).toHaveBeenCalledOnce()
  })

  it.each([
    ['loading', 'Restoring account session'],
    ['signing_in', 'Completing browser sign-in'],
    ['signed_out', 'Not signed in — open account settings'],
    ['error', 'Account sign-in needs attention'],
    ['unconfigured', 'Account sign-in is unavailable in this build'],
  ] as const)('shows the %s account state', (status, label) => {
    useAuthStore.setState({ status })

    render(<Sidebar onAccountClick={onAccountClick} onSettingsClick={onSettingsClick} />)

    expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
  })

  it('uses the settings callback for the settings button', () => {
    render(<Sidebar onAccountClick={onAccountClick} onSettingsClick={onSettingsClick} />)

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))

    expect(onSettingsClick).toHaveBeenCalledOnce()
  })
})
