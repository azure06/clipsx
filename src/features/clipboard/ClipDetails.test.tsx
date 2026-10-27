import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import { ClipDetails } from './ClipDetails'
it('shows structured metadata and restores keyboard focus on Escape', async () => {
  const user = userEvent.setup()
  render(
    <ClipDetails
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
