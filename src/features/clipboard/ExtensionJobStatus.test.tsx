import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ExtensionJobActivity, jobStatusLabel } from './ExtensionJobStatus'
import type { ExtensionJob } from './useClipExtensionJobs'

const job = (status: ExtensionJob['status']) =>
  ({ jobId: status, displayLabel: 'Rewrite · Business', status, reasonCode: null }) as ExtensionJob

describe('extension job activity', () => {
  it('shows automatic running work without opening its tab, and opens details explicitly', () => {
    const select = vi.fn()
    render(
      <ExtensionJobActivity
        jobs={[job('pending'), job('running')]}
        error={null}
        onSelect={select}
        onRetry={vi.fn()}
      />
    )
    expect(screen.getByRole('status')).toHaveTextContent('Running')
    expect(screen.getByRole('status')).toHaveTextContent('+1')
    expect(select).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button'))
    expect(select).toHaveBeenCalledWith('running')
  })
  it('keeps failure and waiting states visible, with readable labels', () => {
    const { rerender } = render(
      <ExtensionJobActivity
        jobs={[job('failed')]}
        error={null}
        onSelect={vi.fn()}
        onRetry={vi.fn()}
      />
    )
    expect(screen.getByRole('status')).toHaveTextContent('Failed')
    rerender(
      <ExtensionJobActivity
        jobs={[job('waiting_provider')]}
        error={null}
        onSelect={vi.fn()}
        onRetry={vi.fn()}
      />
    )
    expect(screen.getByRole('status')).toHaveTextContent('Waiting for model')
    expect(jobStatusLabel(job('waiting_write_review'))).toBe('Needs delivery review')
  })
  it('does not label completed or cancelled jobs as ongoing and offers status refresh on error', () => {
    const retry = vi.fn()
    const { rerender } = render(
      <ExtensionJobActivity
        jobs={[job('completed'), job('cancelled')]}
        error={null}
        onSelect={vi.fn()}
        onRetry={retry}
      />
    )
    expect(screen.queryByRole('status')).toBeNull()
    rerender(<ExtensionJobActivity jobs={[]} error="offline" onSelect={vi.fn()} onRetry={retry} />)
    fireEvent.click(screen.getByRole('button', { name: 'Status unavailable · Retry' }))
    expect(retry).toHaveBeenCalledOnce()
  })
})
