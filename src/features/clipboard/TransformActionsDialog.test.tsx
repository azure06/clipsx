import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TransformActionsPanel } from './TransformActionsDialog'
import type { ContextAction } from './useTransformState'

const action = (overrides: Partial<ContextAction> = {}): ContextAction => ({
  id: 'decode-base64',
  packageId: 'infiniti.base64',
  label: 'Decode Base64',
  icon: null,
  iconSvg: null,
  iconSvgDark: null,
  iconScale: 1,
  placements: ['action_menu'],
  effects: ['preview'],
  transformPreset: false,
  execution: 'local',
  available: true,
  unavailableReason: null,
  parameterSchema: {},
  shortcut: null,
  pinned: false,
  consentRequired: false,
  externalNavigationOrigins: [],
  httpOrigins: [],
  providers: [],
  ...overrides,
})

describe('TransformActionsPanel', () => {
  it('groups transformer presets with transforms instead of extension actions', () => {
    render(
      <TransformActionsPanel
        items={[{ id: 'format', label: 'Format', version: '1' }]}
        actions={[
          action({ id: 'encode-base64', label: 'Encode with Base64', transformPreset: true }),
          action({ id: 'ask-ai', label: 'Ask AI' }),
        ]}
        busy={null}
        run={vi.fn()}
        runAction={vi.fn()}
        pinAction={vi.fn()}
        onClose={vi.fn()}
      />
    )

    expect(screen.getByText('Transform')).toBeInTheDocument()
    expect(screen.getByText('Tools')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Format' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Encode with Base64' })).toBeInTheDocument()
    const transforms = screen.getByRole('heading', { name: 'Transform' }).parentElement
    const extensionActions = screen.getByRole('heading', {
      name: 'Extension actions',
    }).parentElement
    expect(transforms).toHaveTextContent('Encode with Base64')
    expect(transforms).not.toHaveTextContent('Ask AI')
    expect(extensionActions).toHaveTextContent('Ask AI')
  })

  it('runs the selected transform', async () => {
    const user = userEvent.setup()
    const run = vi.fn()
    const onClose = vi.fn()
    render(
      <TransformActionsPanel
        items={[{ id: 'format', label: 'Format', version: '1' }]}
        actions={[]}
        busy={null}
        run={run}
        runAction={vi.fn()}
        pinAction={vi.fn()}
        onClose={onClose}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Format' }))

    expect(run).toHaveBeenCalledWith('format')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('does not run an unavailable action', async () => {
    const user = userEvent.setup()
    const runAction = vi.fn()
    render(
      <TransformActionsPanel
        items={[]}
        actions={[action({ available: false, unavailableReason: 'Input is not UTF-8 Base64' })]}
        busy={null}
        run={vi.fn()}
        runAction={runAction}
        pinAction={vi.fn()}
        onClose={vi.fn()}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Decode Base64' }))

    expect(runAction).not.toHaveBeenCalled()
  })

  it('pins an action without closing the dialog', async () => {
    const user = userEvent.setup()
    const pinAction = vi.fn()
    const onClose = vi.fn()
    render(
      <TransformActionsPanel
        items={[]}
        actions={[action()]}
        busy={null}
        run={vi.fn()}
        runAction={vi.fn()}
        pinAction={pinAction}
        onClose={onClose}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Pin Decode Base64' }))

    expect(pinAction).toHaveBeenCalledWith('decode-base64', true)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('shows pinned actions and transform presets first without duplication', () => {
    render(
      <TransformActionsPanel
        items={[]}
        actions={[
          action({ id: 'pinned-action', label: 'Pinned action', pinned: true }),
          action({
            id: 'pinned-transform',
            label: 'Pinned decoder',
            pinned: true,
            transformPreset: true,
          }),
          action({ id: 'regular-action', label: 'Regular action' }),
          action({ id: 'regular-transform', label: 'Regular decoder', transformPreset: true }),
        ]}
        busy={null}
        run={vi.fn()}
        runAction={vi.fn()}
        pinAction={vi.fn()}
        onClose={vi.fn()}
      />
    )

    const headings = screen.getAllByRole('heading').map(heading => heading.textContent)
    const pinnedSection = screen.getByRole('heading', { name: 'Pinned' }).parentElement
    const regularSection = screen.getByRole('heading', { name: 'Extension actions' }).parentElement
    const transforms = screen.getByRole('heading', { name: 'Transform' }).parentElement
    expect(headings).toEqual(['Tools', 'Pinned', 'Extension actions', 'Transform'])
    expect(pinnedSection).toHaveTextContent('Pinned action')
    expect(pinnedSection).toHaveTextContent('Pinned decoder')
    expect(regularSection).toHaveTextContent('Regular action')
    expect(regularSection).not.toHaveTextContent('Pinned action')
    expect(transforms).toHaveTextContent('Regular decoder')
    expect(transforms).not.toHaveTextContent('Pinned decoder')
  })

  it('collapses from its header control', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <TransformActionsPanel
        items={[{ id: 'format', label: 'Format', version: '1' }]}
        actions={[]}
        busy={null}
        run={vi.fn()}
        runAction={vi.fn()}
        pinAction={vi.fn()}
        onClose={onClose}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Collapse tools' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
