import * as Dialog from '@radix-ui/react-dialog'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ExtensionResultTab, ExtensionTools } from './ExtensionWorkspace'
import type { PinnedOperation } from './ExtensionOperationIcon'
import { retainInstalledPins } from './extensionPins'
import type { ExtensionJob } from './useClipExtensionJobs'
import type { Transformer } from './useTransformState'

const invokeMock = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))
vi.mock('../../shared/hooks/useTheme', () => ({
  useTheme: () => ({ appliedTheme: 'light' }),
}))

const transformer: Transformer = {
  id: 'infiniti.rewrite/rewrite',
  packageId: 'infiniti.rewrite',
  label: 'Rewrite',
  version: '2.0.0',
  parameterSchema: { type: 'object', properties: { preset: { type: 'string', enum: ['business', 'casual'] } }, required: ['preset'] },
  execution: 'local',
  consentRequired: false,
  httpOrigins: [],
  providers: [],
  setups: [{ id: 'business', displayName: 'Business', parameters: { preset: 'business' } }],
  defaultView: 'result_only',
  resultControls: ['copy', 'regenerate'],
  providerAvailable: true,
}

describe('one durable transformation path', () => {
  beforeEach(() => {
    localStorage.clear()
    invokeMock.mockReset()
    invokeMock.mockImplementation((command: string) => {
      if (command === 'list_extension_transform_setups') return Promise.resolve([])
      if (command === 'enqueue_extension_transform') return Promise.resolve({ jobId: 'job-1', reused: false })
      return Promise.resolve(null)
    })
  })

  it('runs a built-in setup through the durable job command', async () => {
    const onQueued = vi.fn()
    render(<Dialog.Root open><Dialog.Content><ExtensionTools clipId="clip-1" sourceId="source-1" transformers={[transformer]} actions={[]} runAction={vi.fn()} onClose={vi.fn()} onQueued={onQueued} /></Dialog.Content></Dialog.Root>)
    fireEvent.click(screen.getByRole('button', { name: /Business/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    await waitFor(() => expect(onQueued).toHaveBeenCalledWith('job-1'))
    const calls = invokeMock.mock.calls as Array<[string, unknown]>
    const argumentsForRun = calls.find(([command]) => command === 'enqueue_extension_transform')?.[1]
    expect(argumentsForRun).toMatchObject({
      request: { clipId: 'clip-1', transformerId: transformer.id, parameters: { preset: 'business' } },
    })
  })

  it('filters operations and pins a specific setup from the modal', () => {
    const onTogglePin = vi.fn()
    render(<Dialog.Root open><Dialog.Content><ExtensionTools clipId="clip-1" sourceId="source-1" transformers={[transformer]} actions={[]} runAction={vi.fn()} onClose={vi.fn()} onQueued={vi.fn()} pinnedIds={[]} onTogglePin={onTogglePin} /></Dialog.Content></Dialog.Root>)
    fireEvent.change(screen.getByRole('textbox', { name: 'Search tools' }), { target: { value: 'business' } })
    expect(screen.getByRole('button', { name: /Business Rewrite/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Custom Rewrite/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Pin Business' }))
    expect(onTogglePin).toHaveBeenCalledWith(expect.objectContaining({ id: `setup:${transformer.id}:business`, packageId: transformer.packageId, label: 'Business' }))
  })

  it('drops pins for uninstalled packages but retains disabled package preferences', () => {
    const pin: PinnedOperation = {
      id: `setup:${transformer.id}:business`, packageId: transformer.packageId,
      label: 'Business', kind: 'transformer', icon: null, iconSvg: null, iconSvgDark: null, iconScale: 1,
    }
    expect(retainInstalledPins([pin], new Set([transformer.packageId]))).toEqual([pin])
    expect(retainInstalledPins([pin], new Set())).toEqual([])
  })

  it('opens a pinned setup and lets the user return to the tool list', async () => {
    render(<Dialog.Root open><Dialog.Content><ExtensionTools clipId="clip-1" sourceId="source-1" transformers={[transformer]} actions={[]} runAction={vi.fn()} onClose={vi.fn()} onQueued={vi.fn()} initialOperationId={`setup:${transformer.id}:business`} /></Dialog.Content></Dialog.Root>)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Back to tools' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Back to tools' }))
    expect(screen.getByRole('textbox', { name: 'Search tools' })).toBeInTheDocument()
  })

  it('shows only controls declared by the transformer for a completed result', () => {
    const job: ExtensionJob = {
      jobId: 'job-1', clipId: 'clip-1', sourceId: 'source-1', packageId: transformer.packageId,
      transformerId: transformer.id, transformerVersion: '2.0.0', displayLabel: 'Rewrite · Business',
      defaultView: 'result_only', status: 'completed', reasonCode: null, parameters: { preset: 'business' },
      resultControls: ['copy', 'regenerate'], resultPresentations: [], outputs: [],
    }
    render(<ExtensionResultTab job={job} presentation={null} canRegenerate onChanged={vi.fn()} onQueued={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Copy result' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Regenerate result' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Paste result' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save as new clip' })).not.toBeInTheDocument()
  })

  it('uses the presentation declared on the completed job', () => {
    const job: ExtensionJob = {
      jobId: 'job-2', clipId: 'clip-1', sourceId: 'source-1', packageId: transformer.packageId,
      transformerId: transformer.id, transformerVersion: '2.0.0', displayLabel: 'Rewrite · Business',
      defaultView: 'compare', status: 'completed', reasonCode: null, parameters: { preset: 'business' },
      resultControls: [], outputs: [],
      resultPresentations: [{ id: 'review', displayName: 'Review', layout: 'stack', modules: ['output', 'input'] }],
    }
    render(<ExtensionResultTab job={job} presentation={null} canRegenerate onChanged={vi.fn()} onQueued={vi.fn()} />)
    expect(screen.getByText('Original')).toBeInTheDocument()
    expect(screen.getByText('Result')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Compare' })).not.toBeInTheDocument()
  })

  it('positions the divider exactly and keeps dragging after pointer capture', () => {
    const job: ExtensionJob = {
      jobId: 'job-split', clipId: 'clip-1', sourceId: 'source-1', packageId: transformer.packageId,
      transformerId: transformer.id, transformerVersion: '2.0.0', displayLabel: 'Rewrite · Business',
      defaultView: 'compare', status: 'completed', reasonCode: null, parameters: {},
      resultControls: [], resultPresentations: [], outputs: [],
    }
    render(<ExtensionResultTab job={job} presentation={null} canRegenerate onChanged={vi.fn()} onQueued={vi.fn()} />)
    const container = screen.getByTestId('extension-result-split')
    const divider = screen.getByRole('separator', { name: 'Resize original and result' })
    Object.defineProperty(container, 'getBoundingClientRect', { value: () => ({ left: 100, width: 800 }) })
    Object.defineProperty(divider, 'setPointerCapture', { value: vi.fn() })
    Object.defineProperty(divider, 'hasPointerCapture', { value: () => true })
    Object.defineProperty(divider, 'releasePointerCapture', { value: vi.fn() })
    expect(container.style.gridTemplateColumns).toBe('minmax(0, 50fr) 8px minmax(0, 50fr)')
    fireEvent.pointerDown(divider, { pointerId: 1, clientX: 500 })
    fireEvent.pointerMove(divider, { pointerId: 1, clientX: 600 })
    expect(divider).toHaveAttribute('aria-valuenow', '63')
    fireEvent.pointerUp(divider, { pointerId: 1 })
    fireEvent.keyDown(divider, { key: 'ArrowLeft' })
    expect(divider).toHaveAttribute('aria-valuenow', '58')
  })
})
