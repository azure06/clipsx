import * as Dialog from '@radix-ui/react-dialog'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { Select } from './Select'

const options = [
  { value: 'one', label: 'One' },
  { value: 'two', label: 'Two' },
] as const

const SelectHarness = () => {
  const [value, setValue] = useState<(typeof options)[number]['value']>('one')
  return <Select value={value} onChange={setValue} options={options} className="w-48" />
}

describe('Select', () => {
  it('groups choices and associates its label, help, and error with the trigger', async () => {
    const user = userEvent.setup()
    render(
      <Select
        value=""
        onChange={() => undefined}
        label="Setup"
        placeholder="Choose a setup"
        helpText="Reusable configuration"
        error="Choose a valid setup"
        groups={[
          {
            label: 'Built-in setups',
            options: [
              { value: 'one', label: 'One' },
              { value: 'blocked', label: 'Unavailable', disabled: true },
            ],
          },
          { label: 'Saved setups', options: [{ value: 'saved', label: 'Technical' }] },
        ]}
      />
    )
    const trigger = screen.getByRole('combobox', { name: 'Setup' })
    expect(trigger).toHaveTextContent('Choose a setup')
    expect(trigger).toHaveAccessibleDescription('Reusable configuration Choose a valid setup')
    expect(trigger).toHaveAttribute('aria-invalid', 'true')
    await user.click(trigger)
    expect(screen.getByRole('group', { name: 'Built-in setups' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Saved setups' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Unavailable' })).toHaveAttribute(
      'aria-disabled',
      'true'
    )
    expect(screen.getByRole('listbox')).toHaveClass('max-w-[calc(100vw-1rem)]')
  })
  it('opens a portalled menu above a containing dialog and restores focus on Escape', async () => {
    const user = userEvent.setup()
    render(
      <Dialog.Root open>
        <Dialog.Content>
          <Dialog.Title>Tools</Dialog.Title>
          <Dialog.Description>Choose a setup</Dialog.Description>
          <SelectHarness />
        </Dialog.Content>
      </Dialog.Root>
    )
    const trigger = screen.getByRole('combobox')
    await user.click(trigger)
    const popup = await screen.findByRole('listbox')
    expect(popup).toHaveClass('z-[80]')
    expect(screen.getByRole('dialog', { hidden: true })).not.toContainElement(popup)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('uses the shared theme surface and matches the popup to the trigger width', async () => {
    const user = userEvent.setup()
    render(<SelectHarness />)

    await user.click(screen.getByRole('combobox'))

    const listbox = await screen.findByRole('listbox')
    expect(listbox).toHaveClass('w-[var(--radix-select-trigger-width)]')
    expect(listbox).toHaveClass('bg-white/95')
    expect(listbox).toHaveClass('dark:bg-slate-900/95')
  })

  it('supports keyboard selection and disabled triggers', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<SelectHarness />)
    const trigger = screen.getByRole('combobox')

    trigger.focus()
    await user.keyboard('{Enter}{ArrowDown}{Enter}')
    expect(trigger).toHaveTextContent('Two')

    rerender(<Select value="one" onChange={() => undefined} options={options} disabled />)
    expect(screen.getByRole('combobox')).toBeDisabled()
  })
})
