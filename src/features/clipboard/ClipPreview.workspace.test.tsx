import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect } from 'react'
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { ClipPreview } from './ClipPreview'
import { clip, job, presentation, view } from './previewFixtures.test-utils'
import type { ExtensionJob } from './useClipExtensionJobs'
const state = vi.hoisted(() => ({
  jobs: [] as ExtensionJob[],
  refresh: vi.fn(),
  toast: vi.fn(),
  queued: null as null | ((id: string, ticket?: number) => void),
  start: null as null | (() => number),
  close: null as null | (() => void),
}))
vi.mock('../../shared/contexts/ToastContext', () => ({ useToast: () => ({ toast: state.toast }) }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(() => Promise.resolve([])) }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(vi.fn())) }))
vi.mock('./useClipExtensionJobs', () => ({
  useClipExtensionJobs: () => ({ jobs: state.jobs, error: null, refresh: state.refresh }),
}))
vi.mock('./ClipActionsToolbar', () => ({ ClipActionsToolbar: () => null }))
vi.mock('./components/NoteField', () => ({ NoteField: () => null }))
vi.mock('./components/TagChips', () => ({ TagChips: () => null }))
vi.mock('./V2ViewPanel', () => ({
  V2ViewPanel: ({
    clipId,
    onPresentation,
    onTabControls,
  }: {
    clipId: string
    onPresentation: (p: ReturnType<typeof presentation>) => void
    onTabControls: (v: unknown) => void
  }) => {
    useEffect(() => {
      onPresentation(presentation(clipId))
      onTabControls({
        views: [view()],
        activeId: 'html-view',
        onTabChange: vi.fn(),
        onShowInspector: vi.fn(),
        preferenceScopes: ['mime'],
        onPreferActive: vi.fn(),
      })
    }, [clipId, onPresentation, onTabControls])
    return <div>Original clip content</div>
  },
}))
vi.mock('./ExtensionWorkspace', () => ({
  ExtensionResultTab: ({ job }: { job: ExtensionJob }) => <div>Result content: {job.jobId}</div>,
  ExtensionTools: ({
    onQueued,
    onRunStarted,
    onClose,
  }: {
    onQueued: typeof state.queued
    onRunStarted: typeof state.start
    onClose: typeof state.close
  }) => {
    state.queued = onQueued
    state.start = onRunStarted
    state.close = onClose
    return <div>Tool options</div>
  },
}))
beforeEach(() => {
  state.jobs = []
  state.refresh.mockReset()
  state.queued = null
  localStorage.clear()
})
describe('preview/results navigation intent', () => {
  it('background results never switch the selected workspace', async () => {
    const mounted = render(<ClipPreview clip={clip()} />)
    await screen.findByText('Original clip content')
    state.jobs = [job()]
    mounted.rerender(<ClipPreview clip={clip()} />)
    expect(screen.getByRole('tab', { name: 'Preview' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Results · 1' })).toHaveAttribute(
      'aria-selected',
      'false'
    )
  })
  it('a manual run selects Results but completion never pulls the user back', async () => {
    const user = userEvent.setup(),
      mounted = render(<ClipPreview clip={clip()} />)
    await user.click(screen.getByRole('button', { name: 'Open clip tools' }))
    let ticket = 0
    act(() => {
      ticket = state.start!()
      state.queued!('job-1', ticket)
    })
    expect(screen.getByRole('tab', { name: 'Results · 0' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await user.click(screen.getByRole('tab', { name: 'Preview' }))
    state.jobs = [job()]
    mounted.rerender(<ClipPreview clip={clip()} />)
    expect(screen.getByRole('tab', { name: 'Preview' })).toHaveAttribute('aria-selected', 'true')
  })
  it('closing Tools during enqueue cancels automatic navigation', async () => {
    const user = userEvent.setup()
    render(<ClipPreview clip={clip()} />)
    await user.click(screen.getByRole('button', { name: 'Open clip tools' }))
    let ticket = 0
    act(() => {
      ticket = state.start!()
      state.close!()
    })
    act(() => state.queued!('job-1', ticket))
    expect(screen.getByRole('tab', { name: 'Preview' })).toHaveAttribute('aria-selected', 'true')
  })
  it('late enqueue callbacks cannot select a result on another clip', async () => {
    const user = userEvent.setup(),
      mounted = render(<ClipPreview clip={clip()} />)
    await user.click(screen.getByRole('button', { name: 'Open clip tools' }))
    const queued = state.queued!
    let ticket = 0
    act(() => {
      ticket = state.start!()
    })
    mounted.rerender(<ClipPreview clip={clip('clip-2')} />)
    act(() => queued('old-job', ticket))
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Preview' })).toHaveAttribute('aria-selected', 'true')
    )
  })
  it('keeps keyboard tab selection available', async () => {
    state.jobs = [job()]
    render(<ClipPreview clip={clip()} />)
    const preview = screen.getByRole('tab', { name: 'Preview' })
    preview.focus()
    fireEvent.keyDown(preview, { key: 'ArrowRight' })
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Results · 1' })).toHaveFocus())
  })
})

it('places collapsed decision details after the preview content', async () => {
  const sample = {
    ...clip(),
    decisionReviews: [
      {
        stage: 'privacy' as const,
        status: 'not_checked' as const,
        reason: 'unavailable' as const,
        evaluatedAt: 1,
      },
    ],
  }
  render(<ClipPreview clip={sample} />)
  const content = await screen.findByText('Original clip content')
  const label = screen.getByText('Privacy not checked.')
  expect(content.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(label.closest('details')).not.toHaveAttribute('open')
})
