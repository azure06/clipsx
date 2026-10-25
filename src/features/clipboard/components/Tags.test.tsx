import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TagFilter } from './TagFilter'
import { TagChips } from './TagChips'

const work = { id: 'work', name: 'work', color: '#8b5cf6' }
const research = { id: 'research', name: 'research', color: null }
const state = {
  availableTags: [work, research],
  tagFilter: null as string | null,
  tagsLoading: false,
  tagsError: null as string | null,
  refreshAvailableTags: vi.fn(async () => {}),
  setTagFilter: vi.fn(async () => {}),
  deleteAvailableTag: vi.fn(async () => {}),
  addClipTag: vi.fn(async () => {}),
  removeClipTag: vi.fn(async () => {}),
  createTagAndAttach: vi.fn(async () => {}),
}
vi.mock('../../../stores/clipboardStore', () => ({
  useClipboardStore: (selector: (s: typeof state) => unknown) => selector(state),
}))

beforeEach(() => {
  vi.clearAllMocks()
  state.availableTags = [work, research]
  state.tagFilter = null
  state.tagsError = null
  state.tagsLoading = false
})

describe('compact tag filter', () => {
  it('searches by a substring, filters with the keyboard, and restores focus', async () => {
    const user = userEvent.setup()
    render(<TagFilter />)
    const trigger = screen.getByRole('button', { name: 'Filter by tag' })
    await user.click(trigger)
    expect(state.refreshAvailableTags).toHaveBeenCalledOnce()
    const input = screen.getByRole('combobox', { name: 'Search tags…' })
    expect(input).toHaveFocus()
    await user.type(input, 'SEARCH')
    expect(screen.queryByRole('option', { name: 'work' })).not.toBeInTheDocument()
    await user.keyboard('{Enter}')
    expect(state.setTagFilter).toHaveBeenCalledWith('research')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })
  it('remains available with no tags and reports an empty search', async () => {
    state.availableTags = []
    const user = userEvent.setup()
    render(<TagFilter />)
    await user.click(screen.getByRole('button', { name: 'Filter by tag' }))
    await user.type(screen.getByRole('combobox'), 'missing')
    expect(screen.getByRole('status')).toHaveTextContent('No matching tags')
  })
  it('shows new catalogue entries while the picker is already open', async () => {
    state.availableTags = [work]
    const user = userEvent.setup()
    const view = render(<TagFilter />)
    await user.click(screen.getByRole('button', { name: 'Filter by tag' }))
    state.availableTags = [work, research]
    view.rerender(<TagFilter />)
    expect(screen.getByRole('option', { name: 'research' })).toBeInTheDocument()
  })
  it('requires confirmation before deleting a tag globally', async () => {
    state.tagFilter = work.id
    const user = userEvent.setup()
    render(<TagFilter />)
    await user.click(screen.getByRole('button', { name: 'Filter by tag' }))
    await user.click(screen.getByRole('button', { name: 'Delete tag' }))
    expect(state.deleteAvailableTag).not.toHaveBeenCalled()
    expect(screen.getByText(/Your clips will stay saved/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Delete tag' }))
    expect(state.deleteAvailableTag).toHaveBeenCalledWith(work.id)
  })
  it('offers retry for catalogue failures without hiding cached tags', async () => {
    state.tagsError = 'offline'
    const user = userEvent.setup()
    render(<TagFilter />)
    await user.click(screen.getByRole('button', { name: 'Filter by tag' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t load tags.')
    expect(screen.getByRole('option', { name: 'work' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(state.refreshAvailableTags).toHaveBeenCalledTimes(2)
  })
  it('keeps a failed selection retryable', async () => {
    state.setTagFilter.mockRejectedValueOnce(new Error('unavailable'))
    const user = userEvent.setup()
    render(<TagFilter />)
    await user.click(screen.getByRole('button', { name: 'Filter by tag' }))
    await user.type(screen.getByRole('combobox'), 'work')
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t update this tag.')
    expect(screen.getByRole('combobox')).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})

describe('preview tags', () => {
  it('searches existing tags, excludes attached tags, and supports creation', async () => {
    const user = userEvent.setup()
    render(<TagChips clipId="clip" tags={[work]} />)
    await user.click(screen.getByRole('button', { name: 'Add tag' }))
    expect(screen.queryByRole('option', { name: 'work' })).not.toBeInTheDocument()
    await user.type(screen.getByRole('combobox'), 'sea')
    await user.keyboard('{Enter}')
    expect(state.addClipTag).toHaveBeenCalledWith('clip', research)
    await user.type(screen.getByRole('combobox'), 'new tag')
    await user.keyboard('{Enter}')
    expect(state.createTagAndAttach).toHaveBeenCalledWith('clip', 'new tag')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add tag' })).toHaveFocus()
  })
  it('does not submit during IME composition', async () => {
    const user = userEvent.setup()
    render(<TagChips clipId="clip" tags={[]} />)
    await user.click(screen.getByRole('button', { name: 'Add tag' }))
    const input = screen.getByRole('combobox')
    await user.type(input, 'new')
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    expect(state.createTagAndAttach).not.toHaveBeenCalled()
  })
  it('reports removal failures and allows another attempt', async () => {
    state.removeClipTag.mockRejectedValueOnce(new Error('failed'))
    const user = userEvent.setup()
    render(<TagChips clipId="clip" tags={[work]} />)
    await user.click(screen.getByRole('button', { name: 'Remove work tag' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Remove work tag' }))
    expect(state.removeClipTag).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
  it('dismisses and releases the custom-view overlay when the clip changes', async () => {
    const overlayStates: boolean[] = []
    const listener = (event: Event) => {
      overlayStates.push((event as CustomEvent<{ open: boolean }>).detail.open)
    }
    window.addEventListener('clipsx-host-overlay', listener)
    const user = userEvent.setup()
    const view = render(<TagChips clipId="clip" tags={[]} />)
    await user.click(screen.getByRole('button', { name: 'Add tag' }))
    expect(overlayStates.at(-1)).toBe(true)
    view.rerender(<TagChips clipId="other" tags={[]} />)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(overlayStates.at(-1)).toBe(false)
    window.removeEventListener('clipsx-host-overlay', listener)
  })
})
