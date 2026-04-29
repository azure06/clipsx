import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { SearchBar } from './SearchBar'

const ScopeHarness = ({
  initialValue = '',
  onScopeChange = vi.fn(),
}: {
  initialValue?: string
  onScopeChange?: (scope: 'all' | 'favorites' | 'pinned') => void
}) => {
  const [value, setValue] = useState(initialValue)

  return (
    <>
      <SearchBar
        value={value}
        onChange={setValue}
        onClear={() => setValue('')}
        onScopeChange={onScopeChange}
      />
      <div data-testid="query-value">{value}</div>
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
})
