import { copyClipboardOutput } from '../../shared/clipboardOutput'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { QuickCopyMenu } from './QuickCopyMenu'
import { quickCopyCandidates } from './quickCopy'
import { transformer, job } from './previewFixtures.test-utils'
const { invoke, toast } = vi.hoisted(() => ({ invoke: vi.fn(), toast: vi.fn() }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(vi.fn())) }))
vi.mock('@tauri-apps/api/core', () => ({ invoke }))
vi.mock('../../shared/contexts/ToastContext', () => ({ useToast: () => ({ toast }) }))
beforeEach(() => {
  invoke.mockReset()
  toast.mockReset()
  localStorage.clear()
  invoke.mockResolvedValue({ jobId: 'job-1' })
})
describe('contextual quick copy', () => {
  const base = () => ({
    clipId: 'clip-1',
    transformers: [transformer()],
    jobs: [],
    refreshJobs: vi.fn().mockResolvedValue(undefined),
    onViewResult: vi.fn(),
  })
  it('uses assessed input, copies the named output, and never opens Results automatically', async () => {
    const props = base(),
      user = userEvent.setup(),
      mounted = render(<QuickCopyMenu {...props} />)
    await user.click(screen.getByRole('button', { name: 'Copy as…' }))
    await user.click(screen.getByRole('menuitem', { name: 'CSV' }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        'enqueue_extension_transform',
        expect.objectContaining({
          request: expect.objectContaining({
            sourceId: 'html',
            parameters: { operation: 'csv' },
          }) as unknown,
        })
      )
    )
    mounted.rerender(<QuickCopyMenu {...props} jobs={[job()]} />)
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('execute_clipboard_output', {
        request: {
          disposition: 'copy',
          source: { kind: 'derived_output', jobId: 'job-1', ordinal: 0 },
        },
      })
    )
    expect(props.onViewResult).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'View result' }))
    expect(props.onViewResult).toHaveBeenCalledWith('job-1')
  })
  it('does not copy a late result after switching clips', async () => {
    const props = base(),
      user = userEvent.setup(),
      mounted = render(<QuickCopyMenu {...props} />)
    await user.click(screen.getByRole('button', { name: 'Copy as…' }))
    await user.click(screen.getByRole('menuitem', { name: 'CSV' }))
    mounted.rerender(<QuickCopyMenu {...props} clipId="clip-2" jobs={[job()]} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copy as…' })).toBeEnabled())
    expect(invoke.mock.calls.filter(([name]) => name === 'execute_clipboard_output')).toHaveLength(
      0
    )
  })
  it.each([job({ status: 'failed', reasonCode: 'invalid_output' }), job({ outputs: [] })])(
    'keeps the clipboard unchanged on failure or mismatched output',
    async result => {
      const props = base(),
        user = userEvent.setup(),
        mounted = render(<QuickCopyMenu {...props} />)
      await user.click(screen.getByRole('button', { name: 'Copy as…' }))
      await user.click(screen.getByRole('menuitem', { name: 'CSV' }))
      mounted.rerender(<QuickCopyMenu {...props} jobs={[result]} />)
      await waitFor(() =>
        expect(toast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
      )
      expect(
        invoke.mock.calls.filter(([name]) => name === 'execute_clipboard_output')
      ).toHaveLength(0)
    }
  )
  it('excludes undeclared, unavailable, configurable and capability-backed operations', () => {
    const original = transformer()
    expect(quickCopyCandidates([{ ...original, execution: 'capability_backed' }])).toEqual([])
    expect(
      quickCopyCandidates([
        { ...original, setupAvailability: { csv: { state: 'disabled', reason: 'invalid' } } },
      ])
    ).toEqual([])
    expect(
      quickCopyCandidates([
        {
          ...original,
          setups: [{ id: 'plain', displayName: 'CSV', parameters: { operation: 'csv' } }],
        },
      ])
    ).toEqual([])
    expect(
      quickCopyCandidates([
        {
          ...original,
          parameterSchema: {
            type: 'object',
            properties: { requiredOption: { type: 'string' } },
            required: ['requiredOption'],
          },
        },
      ])
    ).toEqual([])
  })
  it('requires an explicit source choice for ambiguous conversions', async () => {
    const user = userEvent.setup(),
      a = transformer(),
      b = {
        ...transformer(),
        id: 'other.data/convert',
        packageId: 'other.data',
        packageLabel: 'Other converter',
        sourceId: 'text',
        setupAvailability: { csv: { state: 'ready' as const, reason: null, sourceId: 'text' } },
      }
    render(<QuickCopyMenu {...base()} transformers={[a, b]} />)
    await user.click(screen.getByRole('button', { name: 'Copy as…' }))
    expect(screen.getByRole('menuitem', { name: 'CSV' })).toHaveAttribute('aria-haspopup', 'menu')
    expect(invoke).not.toHaveBeenCalled()
  })
  it('reports clipboard failures and permits another explicit attempt', async () => {
    const props = base(),
      user = userEvent.setup(),
      mounted = render(<QuickCopyMenu {...props} />)
    invoke.mockImplementation((command: string) =>
      command === 'execute_clipboard_output'
        ? Promise.reject(new Error('clipboard busy'))
        : Promise.resolve({ jobId: 'job-1' })
    )
    await user.click(screen.getByRole('button', { name: 'Copy as…' }))
    await user.click(screen.getByRole('menuitem', { name: 'CSV' }))
    mounted.rerender(<QuickCopyMenu {...props} jobs={[job()]} />)
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Could not copy converted content', type: 'error' })
      )
    )
    expect(screen.getByRole('button', { name: 'Copy as…' })).toBeEnabled()
  })
  it('does not overwrite a newer explicit clipboard request', async () => {
    const props = base(),
      user = userEvent.setup(),
      mounted = render(<QuickCopyMenu {...props} />)
    await user.click(screen.getByRole('button', { name: 'Copy as…' }))
    await user.click(screen.getByRole('menuitem', { name: 'CSV' }))
    await copyClipboardOutput({ kind: 'original', clipId: 'clip-1' })
    mounted.rerender(<QuickCopyMenu {...props} jobs={[job()]} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copy as…' })).toBeEnabled())
    expect(invoke.mock.calls.filter(([name]) => name === 'execute_clipboard_output')).toHaveLength(
      1
    )
  })
})
