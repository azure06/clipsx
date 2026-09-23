import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { AccountSignInOptions } from './AccountSignInOptions'

describe('AccountSignInOptions', () => {
  it('offers Google and GitHub and keeps email/password unavailable', () => {
    render(<AccountSignInOptions status="signed_out" signingInProvider={null} onSignIn={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Continue with GitHub' })).toBeEnabled()
    expect(screen.getByText('Email and password')).toBeVisible()
    expect(screen.getByText('Coming later')).toBeVisible()
    expect(screen.getByText('Email and password').closest('[aria-disabled="true"]')).not.toBeNull()
  })

  it.each([
    ['google', 'Continue with Google'],
    ['github', 'Continue with GitHub'],
  ] as const)('selects %s from its provider button', (provider, label) => {
    const onSignIn = vi.fn()
    render(
      <AccountSignInOptions status="signed_out" signingInProvider={null} onSignIn={onSignIn} />
    )

    fireEvent.click(screen.getByRole('button', { name: label }))

    expect(onSignIn).toHaveBeenCalledWith(provider)
  })

  it('shows loading only for the selected provider and disables both choices', () => {
    render(
      <AccountSignInOptions status="signing_in" signingInProvider="github" onSignIn={vi.fn()} />
    )

    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Continue with GitHub' })).toBeDisabled()
    expect(screen.getByText('Opening browser…')).toBeVisible()
    expect(screen.getByText('Continue with Google')).toBeVisible()
  })
})
