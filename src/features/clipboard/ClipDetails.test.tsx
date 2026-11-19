import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { ClipDetails } from './ClipDetails'
import type { AutomationAttempt } from '../extensions/automationAttempts'

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))
vi.mock('@tauri-apps/api/event', () => ({ listen: () => Promise.resolve(() => undefined) }))

beforeEach(() => {
  invokeMock.mockReset().mockResolvedValue([])
})

it('shows structured metadata and restores keyboard focus on Escape', async () => {
  const user = userEvent.setup()
  render(
    <ClipDetails
      clipId="clip-1"
      capturedAt={1}
      source="Excel"
      stats={{ characters: 120, lines: 4, language: 'csv' }}
      ocr={null}
    />
  )
  const button = screen.getByRole('button', { name: 'Details' })
  await user.click(button)
  expect(screen.getByRole('dialog', { name: 'Clip details' })).toHaveAccessibleDescription(
    'Source, capture time and preview information'
  )
  expect(screen.getByText('Excel')).toBeVisible()
  expect(screen.getByText('120')).toBeVisible()
  expect(screen.getByText('Captured')).toBeVisible()
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(button).toHaveFocus()
})
it('shows a translated OCR state without exposing raw error details', async () => {
  const user = userEvent.setup()
  render(
    <ClipDetails
      clipId="clip-1"
      capturedAt={1}
      source={null}
      stats={null}
      ocr={{ state: 'failed', message: 'private raw diagnostic' }}
    />
  )
  await user.click(screen.getByRole('button', { name: 'Details' }))
  expect(screen.getByText('Could not recognize text')).toBeVisible()
  expect(screen.queryByText('private raw diagnostic')).not.toBeInTheDocument()
})

it('shows independent attempts and retries the failed rule from clip details', async () => {
  const user = userEvent.setup()
  const common = {
    packageId: 'example.rewrite',
    activationId: 'on-copy',
    capturedAt: 1,
    jobStatus: null,
    jobReasonCode: null,
  }
  const failed: AutomationAttempt = {
    ...common,
    eventId: 'failed-event',
    ruleId: 'business',
    setupLabel: 'Business',
    status: 'failed',
    reasonCode: 'decision_timeout',
  }
  const skipped: AutomationAttempt = {
    ...common,
    eventId: 'skipped-event',
    ruleId: 'summary',
    setupLabel: 'Summary',
    status: 'skipped',
    reasonCode: 'no_match',
  }
  invokeMock
    .mockResolvedValueOnce([failed, skipped])
    .mockResolvedValueOnce(undefined)
    .mockResolvedValueOnce([{ ...failed, status: 'pending', reasonCode: null }, skipped])
  render(<ClipDetails clipId="clip-1" capturedAt={1} source={null} stats={null} ocr={null} />)
  await user.click(screen.getByRole('button', { name: 'Details' }))
  const automation = await screen.findByText('Automation', { selector: 'summary' })
  expect(automation.closest('details')).not.toHaveAttribute('open')
  await user.click(automation)
  expect(screen.getByText(/decision check timed out/i)).toBeVisible()
  expect(screen.getByText(/condition didn’t match/i)).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Retry' }))
  expect(invokeMock).toHaveBeenCalledWith('retry_extension_automation', {
    packageId: failed.packageId,
    eventId: failed.eventId,
    activationId: failed.activationId,
  })
  expect(await screen.findByText('Waiting for evaluation…')).toBeVisible()
})
