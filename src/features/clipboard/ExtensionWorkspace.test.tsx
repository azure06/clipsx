import * as Dialog from '@radix-ui/react-dialog'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ExtensionResultTab, ExtensionTools } from './ExtensionWorkspace'
import type { PinnedOperation } from './ExtensionOperationIcon'
import { retainInstalledPins } from './extensionPins'
import type { ExtensionJob } from './useClipExtensionJobs'
import type { ContextAction, Transformer } from './useTransformState'
import { useUIStore } from '../../stores/uiStore'

const invokeMock = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))
vi.mock('../../shared/hooks/useTheme', () => ({
  useTheme: () => ({ appliedTheme: 'light' }),
}))

const transformer: Transformer = {
  id: 'infiniti.rewrite/rewrite',
  sourceId: 'source-1',
  packageId: 'infiniti.rewrite',
  label: 'Rewrite',
  version: '2.0.0',
  parameterSchema: {
    type: 'object',
    properties: { preset: { type: 'string', enum: ['business', 'casual'] } },
    required: ['preset'],
  },
  execution: 'local',
  consentRequired: false,
  httpOrigins: [],
  providers: [],
  setups: [{ id: 'business', displayName: 'Business', parameters: { preset: 'business' } }],
  defaultView: 'result_only',
  resultControls: ['copy', 'regenerate'],
  providerAvailable: true,
  setupAvailability: { business: { state: 'ready', reason: null } },
  customAvailability: { state: 'ready', reason: null },
}

describe('one durable transformation path', () => {
  beforeEach(() => {
    localStorage.clear()
    invokeMock.mockReset()
    invokeMock.mockImplementation((command: string) => {
      if (command === 'list_extension_transform_setups') return Promise.resolve([])
      if (command === 'enqueue_extension_transform')
        return Promise.resolve({ jobId: 'job-1', reused: false })
      return Promise.resolve(null)
    })
  })

  it('runs a built-in setup through the durable job command', async () => {
    const onQueued = vi.fn()
    render(
      <Dialog.Root open>
        <Dialog.Content>
          <ExtensionTools
            clipId="clip-1"
            sourceId="source-1"
            transformers={[transformer]}
            actions={[]}
            runAction={vi.fn()}
            onClose={vi.fn()}
            onQueued={onQueued}
          />
        </Dialog.Content>
      </Dialog.Root>
    )
    fireEvent.click(screen.getByRole('button', { name: /Rewrite/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    await waitFor(() => expect(onQueued).toHaveBeenCalledWith('job-1'))
    const calls = invokeMock.mock.calls as Array<[string, unknown]>
    const argumentsForRun = calls.find(
      ([command]) => command === 'enqueue_extension_transform'
    )?.[1]
    expect(argumentsForRun).toMatchObject({
      request: {
        clipId: 'clip-1',
        transformerId: transformer.id,
        parameters: { preset: 'business' },
      },
    })
  })

  it('updates an action pin appearance without affecting the other action', async () => {
    const action: ContextAction = {
      id: 'infiniti.ask-ai/chatgpt',
      packageId: 'infiniti.ask-ai',
      label: 'Ask ChatGPT',
      icon: 'globe',
      iconSvg: null,
      iconSvgDark: null,
      iconScale: 1,
      placements: ['action_menu'],
      effects: ['open_https_url'],
      execution: 'local',
      available: true,
      unavailableReason: null,
      parameterSchema: {},
      shortcut: null,
      consentRequired: false,
      externalNavigationOrigins: [],
      httpOrigins: [],
      providers: [],
    }
    let pins: string[] = []
    const onTogglePin = vi.fn((operation: PinnedOperation) => {
      pins = pins.includes(operation.id) ? [] : [operation.id]
    })
    const view = () => (
      <Dialog.Root open>
        <Dialog.Content>
          <ExtensionTools
            clipId="clip-1"
            sourceId="source-1"
            transformers={[]}
            actions={[action, { ...action, id: 'infiniti.ask-ai/claude', label: 'Ask Claude' }]}
            runAction={vi.fn()}
            onClose={vi.fn()}
            onQueued={vi.fn()}
            pinnedIds={pins}
            onTogglePin={onTogglePin}
          />
        </Dialog.Content>
      </Dialog.Root>
    )
    const { rerender } = render(view())
    fireEvent.click(await screen.findByRole('button', { name: /Ask ai/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Pin Ask ChatGPT' }))
    rerender(view())
    expect(screen.getByRole('button', { name: 'Unpin Ask ChatGPT' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(screen.getByRole('button', { name: 'Unpin Ask ChatGPT' })).toHaveClass('text-amber-500')
    expect(screen.getByRole('button', { name: 'Pin Ask Claude' })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
    fireEvent.click(screen.getByRole('button', { name: 'Unpin Ask ChatGPT' }))
    rerender(view())
    expect(screen.getByRole('button', { name: 'Pin Ask ChatGPT' })).toHaveClass('text-slate-500')
  })

  it('filters operations and pins a specific setup from the modal', () => {
    const onTogglePin = vi.fn()
    render(
      <Dialog.Root open>
        <Dialog.Content>
          <ExtensionTools
            clipId="clip-1"
            sourceId="source-1"
            transformers={[transformer]}
            actions={[]}
            runAction={vi.fn()}
            onClose={vi.fn()}
            onQueued={vi.fn()}
            pinnedIds={[]}
            onTogglePin={onTogglePin}
          />
        </Dialog.Content>
      </Dialog.Root>
    )
    fireEvent.change(screen.getByRole('textbox', { name: 'Search tools' }), {
      target: { value: 'business' },
    })
    expect(screen.getAllByRole('button', { name: /Rewrite/ })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: /Rewrite/ }))
    expect(screen.queryByRole('button', { name: /Custom Rewrite/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Pin Business' }))
    expect(onTogglePin).toHaveBeenCalledWith(
      expect.objectContaining({
        id: `setup:${transformer.id}:business`,
        packageId: transformer.packageId,
        label: 'Business',
      })
    )
  })

  it('hides an irrelevant setup and runs the eligible setup with its matched source', async () => {
    const eligible: Transformer = {
      ...transformer,
      sourceId: 'text-source',
      setups: [
        ...transformer.setups,
        { id: 'casual', displayName: 'Casual', parameters: { preset: 'casual' } },
      ],
      setupAvailability: {
        business: { state: 'ready', reason: null, sourceId: 'text-source' },
        casual: { state: 'hidden', reason: null },
      },
      customAvailability: { state: 'hidden', reason: null },
    }
    const onQueued = vi.fn()
    render(
      <Dialog.Root open>
        <Dialog.Content>
          <ExtensionTools
            clipId="clip-1"
            sourceId="html-source"
            transformers={[eligible]}
            actions={[]}
            runAction={vi.fn()}
            onClose={vi.fn()}
            onQueued={onQueued}
          />
        </Dialog.Content>
      </Dialog.Root>
    )
    expect(screen.queryByRole('button', { name: /Casual/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Rewrite/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    await waitFor(() => expect(onQueued).toHaveBeenCalledWith('job-1'))
    expect(invokeMock).toHaveBeenCalledWith(
      'enqueue_extension_transform',
      expect.objectContaining<{ request: unknown }>({
        request: expect.objectContaining<{ sourceId: string }>({ sourceId: 'text-source' }),
      })
    )
  })

  it('drops pins for uninstalled packages but retains disabled package preferences', () => {
    const pin: PinnedOperation = {
      id: `setup:${transformer.id}:business`,
      packageId: transformer.packageId,
      label: 'Business',
      kind: 'transformer',
      icon: null,
      iconSvg: null,
      iconSvgDark: null,
      iconScale: 1,
    }
    expect(retainInstalledPins([pin], new Set([transformer.packageId]))).toEqual([pin])
    expect(retainInstalledPins([pin], new Set())).toEqual([])
    const saved = { ...pin, id: 'saved:deleted' }
    expect(retainInstalledPins([saved], new Set([transformer.packageId]), new Set())).toEqual([])
    expect(
      retainInstalledPins([saved], new Set([transformer.packageId]), new Set(['deleted']))
    ).toEqual([saved])
  })

  it('opens a pinned setup and lets the user return to the tool list', async () => {
    render(
      <Dialog.Root open>
        <Dialog.Content>
          <ExtensionTools
            clipId="clip-1"
            sourceId="source-1"
            transformers={[transformer]}
            actions={[]}
            runAction={vi.fn()}
            onClose={vi.fn()}
            onQueued={vi.fn()}
            initialOperationId={`setup:${transformer.id}:business`}
          />
        </Dialog.Content>
      </Dialog.Root>
    )
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Back to tools' })).toBeInTheDocument()
    )
    fireEvent.click(screen.getByRole('button', { name: 'Back to tools' }))
    expect(screen.getByRole('textbox', { name: 'Search tools' })).toBeInTheDocument()
  })

  it('opens automation settings with a saved setup preselected', async () => {
    const saved = {
      id: 'saved-technical',
      packageId: transformer.packageId,
      transformerId: transformer.id,
      label: 'Technical',
      parameters: { preset: 'casual' },
      defaultView: 'compare',
      revision: 3,
      available: true,
    }
    invokeMock.mockImplementation((command: string) =>
      Promise.resolve(command === 'list_extension_transform_setups' ? [saved] : null)
    )
    render(
      <Dialog.Root open>
        <Dialog.Content>
          <ExtensionTools
            clipId="clip-1"
            sourceId="source-1"
            transformers={[
              {
                ...transformer,
                setupAvailability: {
                  ...transformer.setupAvailability,
                  'saved:saved-technical': { state: 'ready', reason: null },
                },
              },
            ]}
            actions={[]}
            runAction={vi.fn()}
            onClose={vi.fn()}
            onQueued={vi.fn()}
            initialOperationId="saved:saved-technical"
          />
        </Dialog.Content>
      </Dialog.Root>
    )
    await screen.findByRole('button', { name: 'Manage automation' })
    expect(screen.getByRole('combobox', { name: 'Setup' })).toHaveTextContent('Technical')
    fireEvent.click(screen.getByRole('button', { name: 'Manage automation' }))
    expect(useUIStore.getState().extensionSettingsRequest).toMatchObject({
      packageId: transformer.packageId,
      section: 'automation',
      setupKind: 'saved',
      setupRef: saved.id,
    })
    useUIStore.getState().clearExtensionSettingsRequest()
  })

  it('shows only controls declared by the transformer for a completed result', () => {
    const job: ExtensionJob = {
      jobId: 'job-1',
      clipId: 'clip-1',
      sourceId: 'source-1',
      packageId: transformer.packageId,
      transformerId: transformer.id,
      transformerVersion: '2.0.0',
      displayLabel: 'Rewrite · Business',
      defaultView: 'result_only',
      status: 'completed',
      reasonCode: null,
      parameters: { preset: 'business' },
      resultControls: ['copy', 'regenerate'],
      outputs: [],
      view: null,
      completedWrites: 0,
    }
    render(
      <ExtensionResultTab
        job={job}
        presentation={null}
        canRegenerate
        onChanged={vi.fn()}
        onQueued={vi.fn()}
      />
    )
    expect(screen.getByRole('button', { name: 'Copy result' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Regenerate result' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Paste result' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save as new clip' })).not.toBeInTheDocument()
  })

  it('uses the presentation declared on the completed job', () => {
    const job: ExtensionJob = {
      jobId: 'job-2',
      clipId: 'clip-1',
      sourceId: 'source-1',
      packageId: transformer.packageId,
      transformerId: transformer.id,
      transformerVersion: '2.0.0',
      displayLabel: 'Rewrite · Business',
      defaultView: 'compare',
      status: 'completed',
      reasonCode: null,
      parameters: { preset: 'business' },
      resultControls: [],
      outputs: [
        {
          ordinal: 0,
          outputId: 'rewritten',
          mimeType: 'text/plain',
          byteLength: 8,
          hasRenderedView: false,
        },
      ],
      view: {
        tabs: [
          {
            id: 'review',
            label: 'Review',
            layout: 'stack',
            panels: [{ source: 'output', outputId: 'rewritten' }, { source: 'input' }],
          },
        ],
      },
      completedWrites: 0,
    }
    render(
      <ExtensionResultTab
        job={job}
        presentation={null}
        canRegenerate
        onChanged={vi.fn()}
        onQueued={vi.fn()}
      />
    )
    expect(screen.getByText('Original')).toBeInTheDocument()
    expect(screen.getByText('Result')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Compare' })).not.toBeInTheDocument()
  })

  it('positions the divider exactly and keeps dragging after pointer capture', () => {
    const job: ExtensionJob = {
      jobId: 'job-split',
      clipId: 'clip-1',
      sourceId: 'source-1',
      packageId: transformer.packageId,
      transformerId: transformer.id,
      transformerVersion: '2.0.0',
      displayLabel: 'Rewrite · Business',
      defaultView: 'compare',
      status: 'completed',
      reasonCode: null,
      parameters: {},
      resultControls: [],
      outputs: [
        {
          ordinal: 0,
          outputId: 'rewritten',
          mimeType: 'text/plain',
          byteLength: 8,
          hasRenderedView: false,
        },
      ],
      view: null,
      completedWrites: 0,
    }
    render(
      <ExtensionResultTab
        job={job}
        presentation={null}
        canRegenerate
        onChanged={vi.fn()}
        onQueued={vi.fn()}
      />
    )
    const container = screen.getByTestId('extension-result-split')
    const divider = screen.getByRole('separator', { name: 'Resize original and result' })
    Object.defineProperty(container, 'getBoundingClientRect', {
      value: () => ({ left: 100, width: 800 }),
    })
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
