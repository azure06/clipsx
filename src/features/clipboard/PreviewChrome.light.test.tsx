import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ClipActionsToolbar } from './ClipActionsToolbar'
import { TagChips } from './components/TagChips'
const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }))
const clipboardStoreState = {
  clips: [],
  availableTags: [{ id: 'tag-urgent', name: 'urgent', color: '#ef4444' }],
  refreshAvailableTags: vi.fn(),
  addClipTag: vi.fn(async () => {}),
  removeClipTag: vi.fn(async () => {}),
  createTagAndAttach: vi.fn(async () => {}),
  performCopy: vi.fn(async () => {}),
}

vi.mock('../../stores/clipboardStore', () => ({
  useClipboardStore: (selector: (state: typeof clipboardStoreState) => unknown) =>
    selector(clipboardStoreState),
}))

vi.mock('../../shared/contexts/ToastContext', () => ({
  useToast: () => ({ toast: toastMock }),
}))

describe('preview chrome light theme styling', () => {
  beforeEach(() => {
    document.documentElement.className = 'light'
    vi.clearAllMocks()
  })

  it('copies by clip id independently of the active renderer', async () => {
    const user = userEvent.setup()

    render(
      <ClipActionsToolbar
        presentation={{
          id: 'clip-1',
          sourceAppName: null,
          sourceAppId: null,
          capturedAt: 1,
          updatedAt: 1,
          isPinned: false,
          isFavorite: false,
          note: null,
          tags: [],
          safeSummary: 'sample',
          representationCount: 2,
          primaryPresentationKind: 'table',
          thumbnailAssetId: null,
          activeView: {
            id: 'alternate-table',
            rendererId: 'builtin.table',
            label: 'Table',
            sourceId: 'rep-table',
            mimeType: 'text/csv',
            capabilityId: 'test.csv',
            facetId: null,
            isOriginal: false,
            presentationKind: 'table',
            purpose: 'structured',
            matchSpecificity: 0,
            placement: 'alternate',
          },
          model: {
            kind: 'table',
            columns: ['A'],
            rows: [['rendered value']],
          },
        }}
        context={{
          onDelete: vi.fn(),
          onTogglePin: vi.fn(),
          onToggleFavorite: vi.fn(),
        }}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Copy' }))

    expect(clipboardStoreState.performCopy).toHaveBeenCalledWith('', 'clip-1')
  })

  it('surfaces a rejected copy instead of showing false success', async () => {
    const user = userEvent.setup()
    clipboardStoreState.performCopy.mockRejectedValueOnce(new Error('clipboard unavailable'))

    render(
      <ClipActionsToolbar
        presentation={{
          id: 'clip-1',
          sourceAppName: null,
          sourceAppId: null,
          capturedAt: 1,
          updatedAt: 1,
          isPinned: false,
          isFavorite: false,
          note: null,
          tags: [],
          safeSummary: 'sample',
          representationCount: 1,
          primaryPresentationKind: 'text',
          thumbnailAssetId: null,
          activeView: {
            id: 'view',
            rendererId: 'builtin.text',
            label: 'Text',
            sourceId: 'rep',
            mimeType: 'text/plain',
            capabilityId: 'test.text',
            facetId: null,
            isOriginal: false,
            presentationKind: 'text',
            purpose: 'faithful',
            matchSpecificity: 0,
            placement: 'primary',
          },
          model: { kind: 'text', text: 'sample' },
        }}
        context={{ onDelete: vi.fn(), onTogglePin: vi.fn(), onToggleFavorite: vi.fn() }}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Copy' }))

    expect(toastMock).toHaveBeenCalledWith({
      title: 'Error',
      description: 'Error: clipboard unavailable',
      type: 'error',
    })
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument()
  })

  it('renders toolbar tooltips with light-safe popover classes', async () => {
    const user = userEvent.setup()

    render(
      <ClipActionsToolbar
        presentation={{
          id: 'clip-1',
          sourceAppName: null,
          sourceAppId: null,
          capturedAt: 1,
          updatedAt: 1,
          isPinned: false,
          isFavorite: false,
          note: null,
          tags: [],
          safeSummary: 'sample',
          representationCount: 1,
          primaryPresentationKind: 'text',
          thumbnailAssetId: null,
          activeView: {
            id: 'view',
            rendererId: 'builtin.text',
            label: 'Text',
            sourceId: 'rep',
            mimeType: 'text/plain',
            capabilityId: 'test.text',
            facetId: null,
            isOriginal: false,
            presentationKind: 'text',
            purpose: 'faithful',
            matchSpecificity: 0,
            placement: 'primary',
          },
          model: { kind: 'text', text: 'sample' },
        }}
        context={{ onDelete: vi.fn(), onTogglePin: vi.fn(), onToggleFavorite: vi.fn() }}
      />
    )

    await user.hover(screen.getByRole('button', { name: 'Copy' }))

    const tooltip = await screen.findByRole('tooltip', { hidden: true })
    expect(tooltip).toHaveClass('text-gray-900')
    expect(tooltip).toHaveClass('bg-white/95')
  })

  it('renders tag suggestions with light-safe dropdown classes', async () => {
    const user = userEvent.setup()

    render(<TagChips clipId="clip-1" tags={[]} />)

    await user.click(screen.getByRole('button', { name: /tag/i }))
    await user.type(screen.getByPlaceholderText('tag name...'), 'u')

    const suggestion = await screen.findByRole('option', { name: /urgent/i })
    expect(suggestion.parentElement).toHaveClass('bg-white/95')
    expect(suggestion).toHaveClass('text-violet-700')
  })

  it('navigates and selects tag suggestions from the keyboard', async () => {
    const user = userEvent.setup()
    render(<TagChips clipId="clip-1" tags={[]} />)

    await user.click(screen.getByRole('button', { name: /tag/i }))
    const input = screen.getByRole('combobox')
    await user.type(input, 'u')

    expect(screen.getByRole('listbox')).toBeInTheDocument()
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{Enter}')

    expect(clipboardStoreState.addClipTag).toHaveBeenCalledWith(
      'clip-1',
      expect.objectContaining({ id: 'tag-urgent' })
    )
  })

  it('supports keyboard tag creation and Escape dismissal', async () => {
    const user = userEvent.setup()
    render(<TagChips clipId="clip-1" tags={[]} />)

    await user.click(screen.getByRole('button', { name: /tag/i }))
    const input = screen.getByRole('combobox')
    await user.type(input, 'new')
    await user.keyboard('{Enter}')
    expect(clipboardStoreState.createTagAndAttach).toHaveBeenCalledWith('clip-1', 'new')

    await user.type(input, 'u')
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})
