import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TransformActionsDialog } from './TransformActionsDialog'
import type { ContextAction } from './useTransformState'

const action = (overrides: Partial<ContextAction> = {}): ContextAction => ({
  id: 'decode-base64',
  packageId: 'firstparty.base64',
  label: 'Decode Base64',
  icon: null,
  iconSvg: null,
  iconSvgDark: null,
  iconScale: 1,
  placements: ['action_menu'],
  effects: ['preview'],
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

describe('TransformActionsDialog', () => {
  it('separates transforms from actions under their own section headings', () => {
    render(
      <TransformActionsDialog
        items={[{ id: 'format', label: 'Format', version: '1' }]}
        actions={[action({ id: 'encode-base64', label: 'Encode with Base64' })]}
        run={vi.fn()}
        runAction={vi.fn()}
        pinAction={vi.fn()}
        onClose={vi.fn()}
      />
    )

    expect(screen.getByText('Transform')).toBeInTheDocument()
    expect(screen.getByText('Actions')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Format' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Encode with Base64' })).toBeInTheDocument()
  })

  it('runs the selected transform and closes', async () => {
    const user = userEvent.setup()
    const run = vi.fn()
    const onClose = vi.fn()
    render(
      <TransformActionsDialog
        items={[{ id: 'format', label: 'Format', version: '1' }]}
        actions={[]}
        run={run}
        runAction={vi.fn()}
        pinAction={vi.fn()}
        onClose={onClose}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Format' }))

    expect(run).toHaveBeenCalledWith('format')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not run an unavailable action', async () => {
    const user = userEvent.setup()
    const runAction = vi.fn()
    render(
      <TransformActionsDialog
        items={[]}
        actions={[action({ available: false, unavailableReason: 'Input is not UTF-8 Base64' })]}
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
      <TransformActionsDialog
        items={[]}
        actions={[action()]}
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

  it('closes on backdrop click and on Escape', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <TransformActionsDialog
        items={[{ id: 'format', label: 'Format', version: '1' }]}
        actions={[]}
        run={vi.fn()}
        runAction={vi.fn()}
        pinAction={vi.fn()}
        onClose={onClose}
      />
    )

    await user.click(screen.getByRole('presentation'))
    expect(onClose).toHaveBeenCalledTimes(1)

    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
