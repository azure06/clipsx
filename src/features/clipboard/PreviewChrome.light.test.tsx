import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ClipActionsToolbar } from './ClipActionsToolbar'
import { TagChips } from './components/TagChips'
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
            facetId: null,
            isOriginal: false,
            presentationKind: 'table',
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
            facetId: null,
            isOriginal: false,
            presentationKind: 'text',
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

    const suggestion = await screen.findByRole('button', { name: /urgent/i })
    expect(suggestion.parentElement).toHaveClass('bg-white/95')
    expect(suggestion).toHaveClass('text-gray-700')
  })
})
