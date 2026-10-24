import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PrivacyCheckIndicator } from './PrivacyCheckIndicator'

const advance = async (milliseconds: number) => {
  await act(() => {
    vi.advanceTimersByTime(milliseconds)
    return Promise.resolve()
  })
}

describe('PrivacyCheckIndicator', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('avoids flashing for quick checks and announces sustained work', async () => {
    vi.useFakeTimers()
    const view = render(<PrivacyCheckIndicator pending={1} />)

    await advance(100)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    view.rerender(<PrivacyCheckIndicator pending={0} />)
    await advance(200)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    view.rerender(<PrivacyCheckIndicator pending={2} />)
    await advance(180)
    expect(screen.getByRole('status')).toHaveTextContent('Checking privacy…2')
  })

  it('stays visible long enough to be perceived after a completed check', async () => {
    vi.useFakeTimers()
    const view = render(<PrivacyCheckIndicator pending={1} />)
    await advance(180)
    expect(screen.getByRole('status')).toBeVisible()

    view.rerender(<PrivacyCheckIndicator pending={0} />)
    await advance(499)
    expect(screen.getByRole('status')).toBeVisible()
    await advance(1)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('changes label and visual treatment when organization starts', async () => {
    vi.useFakeTimers()
    const view = render(<PrivacyCheckIndicator pending={1} phase="privacy" />)
    await advance(180)
    expect(screen.getByRole('status')).toHaveTextContent('Checking privacy…')
    expect(screen.getByRole('status').className).toContain('text-violet-700')
    view.rerender(<PrivacyCheckIndicator pending={1} phase="organizing" />)
    expect(screen.getByRole('status')).toHaveTextContent('Applying rules…')
    expect(screen.getByRole('status').className).toContain('text-blue-700')
  })
})
