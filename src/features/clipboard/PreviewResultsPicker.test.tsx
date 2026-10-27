import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { it, expect, vi } from 'vitest'
import { PreviewResultsPicker } from './PreviewResultsPicker'
import { job } from './previewFixtures.test-utils'
it('searches retained runs and selects with the keyboard', async () => {
  const user = userEvent.setup(),
    onSelect = vi.fn()
  render(
    <PreviewResultsPicker
      jobs={[
        job({ displayLabel: 'Encode URL' }),
        job({ jobId: 'rewrite', displayLabel: 'Business rewrite' }),
      ]}
      selectedId="job-1"
      onSelect={onSelect}
    />
  )
  await user.click(screen.getByRole('combobox'))
  const search = screen.getByRole('searchbox', { name: 'Search transformation results…' })
  await user.type(search, 'business')
  expect(screen.queryByRole('option', { name: 'Encode URL' })).not.toBeInTheDocument()
  await user.keyboard('{Enter}')
  expect(onSelect).toHaveBeenCalledWith('rewrite')
  expect(screen.getByRole('combobox')).toHaveFocus()
})
it('keeps the selected run when new background results appear', () => {
  const onSelect = vi.fn(),
    old = job({ displayLabel: 'Selected result' }),
    mounted = render(
      <PreviewResultsPicker jobs={[old]} selectedId={old.jobId} onSelect={onSelect} />
    )
  mounted.rerender(
    <PreviewResultsPicker
      jobs={[job({ jobId: 'new', displayLabel: 'New background result' }), old]}
      selectedId={old.jobId}
      onSelect={onSelect}
    />
  )
  expect(screen.getByRole('combobox')).toHaveTextContent('Selected result')
  expect(onSelect).not.toHaveBeenCalled()
})
