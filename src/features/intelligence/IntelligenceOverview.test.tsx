import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { IntelligenceOverview } from './IntelligenceOverview'
import type { TextEmbeddingStatus } from '../../shared/types/v2'

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))
beforeEach(() => {
  mocks.invoke.mockReset().mockImplementation((command: string) =>
    Promise.resolve(
      command === 'privacy_settings'
        ? { skipSecrets: false, rules: [{ enabled: true }, { enabled: false }] }
        : {
            configuration: {
              presets: [{ id: 'local', name: 'Local model' }],
              selections: { defaultDecision: 'local' },
            },
          }
    )
  )
})

it('shows model assignments and rule counts without claiming provider readiness', async () => {
  const user = userEvent.setup()
  const navigate = vi.fn()
  render(<IntelligenceOverview status={null} loading={false} ocr={null} onNavigate={navigate} />)
  expect(await screen.findByText('Local model')).toBeVisible()
  expect(screen.getByText('1 enabled rule')).toBeVisible()
  expect(screen.getByText('Built-in secret detection only')).toBeVisible()
  expect(screen.queryByText('Ready')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: /Decision rules/ }))
  expect(navigate).toHaveBeenLastCalledWith('rules')
  await user.click(screen.getByRole('button', { name: 'Manage models' }))
  expect(navigate).toHaveBeenLastCalledWith('models')
  await user.click(screen.getByRole('button', { name: 'Manage search index' }))
  expect(navigate).toHaveBeenLastCalledWith('indexing')
  await user.click(screen.getByRole('button', { name: 'Integrations' }))
  expect(navigate).toHaveBeenLastCalledWith('integrations')
})

it('keeps available details visible and retries a failed setup request', async () => {
  const user = userEvent.setup()
  mocks.invoke.mockRejectedValueOnce(new Error('offline'))
  render(<IntelligenceOverview status={null} loading={false} ocr={null} onNavigate={vi.fn()} />)
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Some setup details could not be loaded'
  )
  expect(screen.getByText('1 enabled rule')).toBeVisible()
  expect(screen.queryByText('No model assigned')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Retry' }))
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  expect(screen.getByText('Local model')).toBeVisible()
})

it('shows real indexing progress and disabled OCR independently of model assignments', async () => {
  const status: TextEmbeddingStatus = {
    enabled: true,
    phase: 'indexing',
    model: 'Search model',
    indexedClips: 2,
    eligibleClips: 8,
    pendingJobs: 6,
    failedJobs: 0,
    diagnostic: null,
    activeSpaceId: null,
    pendingSpaceId: null,
    dimensions: null,
    indexBytes: 0,
    estimatedRebuildBytes: 0,
    minimumSimilarityPercent: null,
  }
  render(
    <IntelligenceOverview
      status={status}
      loading={false}
      ocr={{ settings: { enabled: false }, provider: { available: true }, failedJobs: 0 }}
      onNavigate={vi.fn()}
    />
  )
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25')
  expect(screen.getByText('2 clips indexed')).toBeVisible()
  expect(screen.getByText('6 waiting')).toBeVisible()
  expect(screen.getByText('Disabled')).toBeVisible()
  expect(await screen.findByText('Local model')).toBeVisible()
})
