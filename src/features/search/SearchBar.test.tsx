import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { SearchBar } from './SearchBar'

const ScopeHarness = ({
  initialValue = '',
  initialScope = 'all' as 'all' | 'favorites' | 'pinned',
  onScopeChange = vi.fn(),
}: {
  initialValue?: string
  initialScope?: 'all' | 'favorites' | 'pinned'
  onScopeChange?: (scope: 'all' | 'favorites' | 'pinned') => void
}) => {
  const [value, setValue] = useState(initialValue)
  const [scope, setScope] = useState<'all' | 'favorites' | 'pinned'>(initialScope)

  const handleScopeChange = (s: 'all' | 'favorites' | 'pinned') => {
    setScope(s)
    onScopeChange(s)
  }

  return (
    <>
      <SearchBar
        value={value}
        onChange={setValue}
        onClear={() => setValue('')}
        onScopeChange={handleScopeChange}
        activeScope={scope}
      />
      <div data-testid="query-value">{value}</div>
      <div data-testid="scope-value">{scope}</div>
    </>
  )
}

describe('SearchBar scope slash commands', () => {
  it('applies /favorites as a scope command and strips it from the query', async () => {
    const onScopeChange = vi.fn()
    render(<ScopeHarness onScopeChange={onScopeChange} />)

    fireEvent.change(screen.getByPlaceholderText('Type to search or paste...'), {
      target: { value: '/favorites' },
    })

    await waitFor(() => {
      expect(onScopeChange).toHaveBeenCalledWith('favorites')
      expect(screen.getByTestId('query-value')).toHaveTextContent('')
    })
  })

  it('keeps type slash filters as search prefixes instead of scope commands', async () => {
    const onScopeChange = vi.fn()
    render(<ScopeHarness onScopeChange={onScopeChange} />)

    fireEvent.change(screen.getByPlaceholderText('Type to search or paste...'), {
      target: { value: '/image' },
    })

    await waitFor(() => {
      expect(onScopeChange).not.toHaveBeenCalled()
      expect(screen.getByTestId('query-value')).toHaveTextContent('/image')
    })
  })

  it('does not suggest /all as a slash command', () => {
    render(<ScopeHarness />)

    fireEvent.change(screen.getByPlaceholderText('Type to search or paste...'), {
      target: { value: '/al' },
    })

    // /all should not appear in the command menu
    expect(screen.queryByText('/all')).not.toBeInTheDocument()
  })

  it('shows a scope pill when activeScope is favorites', () => {
    render(<ScopeHarness initialScope="favorites" />)
    expect(screen.getByText('Favorites')).toBeInTheDocument()
  })

  it('shows a scope pill when activeScope is pinned', () => {
    render(<ScopeHarness initialScope="pinned" />)
    expect(screen.getByText('Pinned')).toBeInTheDocument()
  })

  it('does not show a scope pill when activeScope is all', () => {
    render(<ScopeHarness initialScope="all" />)
    expect(screen.queryByText('All Clips')).not.toBeInTheDocument()
  })

  it('clears scope back to all when X button on scope pill is clicked', async () => {
    const onScopeChange = vi.fn()
    render(<ScopeHarness initialScope="favorites" onScopeChange={onScopeChange} />)

    const clearButton = screen.getByRole('button', { name: /clear scope filter/i })
    fireEvent.click(clearButton)

    await waitFor(() => {
      expect(onScopeChange).toHaveBeenCalledWith('all')
    })
  })

  it('clears scope back to all when Backspace is pressed on empty input with active scope pill', async () => {
    const onScopeChange = vi.fn()
    render(<ScopeHarness initialScope="pinned" onScopeChange={onScopeChange} />)

    const input = screen.getByRole('textbox')
    expect(input).toHaveValue('')

    fireEvent.keyDown(input, { key: 'Backspace' })

    await waitFor(() => {
      expect(onScopeChange).toHaveBeenCalledWith('all')
    })
  })

  it('does not clear scope when Backspace is pressed but input has text', async () => {
    const onScopeChange = vi.fn()
    render(
      <ScopeHarness initialScope="favorites" initialValue="hello" onScopeChange={onScopeChange} />
    )

    const input = screen.getByRole('textbox')
    fireEvent.keyDown(input, { key: 'Backspace' })

    // onScopeChange should not be called since input is not empty
    await waitFor(() => {
      expect(onScopeChange).not.toHaveBeenCalled()
    })
  })

  it('clears a type filter pill entirely when Backspace is pressed on empty input', async () => {
    const onChange = vi.fn()
    render(<SearchBar value="/image" onChange={onChange} onClear={vi.fn()} />)

    const input = screen.getByRole('textbox')
    // input shows empty (displayValue strips the /image prefix)
    expect(input).toHaveValue('')
    fireEvent.keyDown(input, { key: 'Backspace' })

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith('')
    })
  })
})
