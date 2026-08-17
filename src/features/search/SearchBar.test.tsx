import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import userEvent from '@testing-library/user-event'
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
  it('exposes slash suggestions as a keyboard-navigable listbox', async () => {
    const user = userEvent.setup()
    render(<ScopeHarness />)

    const input = screen.getByRole('combobox')
    await user.type(input, '/')

    const listbox = screen.getByRole('listbox')
    expect(listbox).toBeInTheDocument()
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true')

    await user.keyboard('{ArrowDown}')
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{Enter}')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('uses accessible source checkboxes and keeps the menu open after toggling', async () => {
    const user = userEvent.setup()
    const onToggleSource = vi.fn()
    render(
      <SearchBar
        value=""
        onChange={vi.fn()}
        onClear={vi.fn()}
        searchSources={[
          {
            id: 'builtin.search.fts',
            label: 'Text search',
            mandatory: true,
            inputKinds: ['text'],
            indexingRequired: false,
            enabled: true,
            state: 'ready',
            diagnostic: null,
          },
          {
            id: 'builtin.search.semantic',
            label: 'Meaning search',
            mandatory: false,
            inputKinds: ['text'],
            indexingRequired: true,
            enabled: false,
            state: 'ready',
            diagnostic: null,
          },
        ]}
        onToggleSource={onToggleSource}
      />
    )

    await user.click(screen.getByRole('button', { name: /sources/i }))
    const mandatory = screen.getByRole('menuitemcheckbox', { name: /text search/i })
    const optional = screen.getByRole('menuitemcheckbox', { name: /meaning search/i })
    expect(mandatory).toHaveAttribute('aria-disabled', 'true')

    await user.click(optional)
    expect(onToggleSource).toHaveBeenCalledWith('builtin.search.semantic')
    expect(screen.getByRole('menu')).toBeInTheDocument()
  })

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

  it('keeps /markdown as a type filter prefix', async () => {
    const onScopeChange = vi.fn()
    render(<ScopeHarness onScopeChange={onScopeChange} />)

    fireEvent.change(screen.getByPlaceholderText('Type to search or paste...'), {
      target: { value: '/markdown' },
    })

    await waitFor(() => {
      expect(onScopeChange).not.toHaveBeenCalled()
      expect(screen.getByTestId('query-value')).toHaveTextContent('/markdown')
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

    const input = screen.getByRole('combobox')
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

    const input = screen.getByRole('combobox')
    fireEvent.keyDown(input, { key: 'Backspace' })

    // onScopeChange should not be called since input is not empty
    await waitFor(() => {
      expect(onScopeChange).not.toHaveBeenCalled()
    })
  })

  it('clears a type filter pill entirely when Backspace is pressed on empty input', async () => {
    const onChange = vi.fn()
    render(<SearchBar value="/image" onChange={onChange} onClear={vi.fn()} />)

    const input = screen.getByRole('combobox')
    // input shows empty (displayValue strips the /image prefix)
    expect(input).toHaveValue('')
    fireEvent.keyDown(input, { key: 'Backspace' })

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith('')
    })
  })

  it('blurs the search input when Escape is pressed', () => {
    render(<SearchBar value="hello" onChange={vi.fn()} onClear={vi.fn()} />)

    const input = screen.getByRole('combobox')
    input.focus()
    expect(document.activeElement).toBe(input)

    fireEvent.keyDown(input, { key: 'Escape' })

    expect(document.activeElement).not.toBe(input)
  })

  it('does not clear query when Escape is pressed', () => {
    const onClear = vi.fn()
    render(<SearchBar value="hello" onChange={vi.fn()} onClear={onClear} />)

    const input = screen.getByRole('combobox')
    fireEvent.keyDown(input, { key: 'Escape' })

    expect(onClear).not.toHaveBeenCalled()
  })
})
