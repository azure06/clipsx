import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { expect, it } from 'vitest'
import { SearchableSelect } from './SearchableSelect'

function Harness() {
  const [value, setValue] = useState('')
  return (
    <SearchableSelect
      label="Model"
      value={value}
      onChange={setValue}
      placeholder="Select a model"
      searchLabel="Search models"
      emptyLabel="No matching models"
      options={[
        { value: 'chat', label: 'Local chat' },
        { value: 'embed', label: 'Local embeddings' },
        { value: 'disabled', label: 'Unavailable embeddings', disabled: true },
      ]}
    />
  )
}
it('filters inside the popup and selects a model with the keyboard', async () => {
  HTMLElement.prototype.scrollIntoView = () => undefined
  const user = userEvent.setup()
  render(<Harness />)
  expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
  await user.click(screen.getByRole('combobox', { name: 'Model' }))
  const search = screen.getByRole('searchbox', { name: 'Search models' })
  expect(search).toHaveFocus()
  await user.type(search, 'embeddings')
  expect(screen.queryByRole('option', { name: 'Local chat' })).not.toBeInTheDocument()
  await user.keyboard('{End}{Enter}')
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  expect(screen.getByRole('combobox')).toHaveTextContent('Local embeddings')
  expect(screen.getByRole('combobox')).toHaveFocus()
})
it('shows empty results and dismisses with Escape without changing the selection', async () => {
  const user = userEvent.setup()
  render(<Harness />)
  await user.click(screen.getByRole('combobox'))
  await user.type(screen.getByRole('searchbox'), 'no-such-model')
  expect(screen.getByRole('status')).toHaveTextContent('No matching models')
  await user.keyboard('{Enter}')
  expect(screen.getByRole('listbox')).toBeInTheDocument()
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  expect(screen.getByRole('combobox')).toHaveFocus()
  expect(screen.getByRole('combobox')).toHaveTextContent('Select a model')
})
