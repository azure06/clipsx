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
