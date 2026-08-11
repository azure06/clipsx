import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ClipActionsToolbar } from './ClipActionsToolbar'
import { TagChips } from './components/TagChips'
import type { ActionContext } from '../content'

const actionExecute = vi.fn()
type MockActionGroups = {
  standard: Array<{
    id: string
    label: string
    icon: ReactElement
    category: 'core'
    placement: 'global_bar'
    check: () => true
    execute: typeof actionExecute
  }>
  smart: []
  meta: []
}

type MockActionRegistry = {
  getActionGroups: (_content: unknown) => MockActionGroups
}

const mockUseActionRegistry = vi.fn<() => MockActionRegistry>()

const clipboardStoreState = {
  clips: [],
  availableTags: [{ id: 1, name: 'urgent', color: '#ef4444', createdAt: 0 }],
  refreshAvailableTags: vi.fn(),
  addClipTag: vi.fn(async () => {}),
  removeClipTag: vi.fn(async () => {}),
  createTagAndAttach: vi.fn(async () => {}),
}

vi.mock('../content', () => ({
  useActionRegistry: (_context?: ActionContext): MockActionRegistry => mockUseActionRegistry(),
}))

vi.mock('../../stores/clipboardStore', () => ({
  useClipboardStore: (selector: (state: typeof clipboardStoreState) => unknown) =>
    selector(clipboardStoreState),
}))

describe('preview chrome light theme styling', () => {
  beforeEach(() => {
    document.documentElement.className = 'light'
    vi.clearAllMocks()

    mockUseActionRegistry.mockReturnValue({
      getActionGroups: () => ({
        standard: [
          {
            id: 'favorite',
            label: 'Favorite',
            icon: <span data-testid="favorite-icon">F</span>,
            category: 'core',
            placement: 'global_bar',
            check: () => true,
            execute: actionExecute,
          },
        ],
        smart: [],
        meta: [],
      }),
    })
  })

  it('renders toolbar tooltips with light-safe popover classes', async () => {
    const user = userEvent.setup()

    render(
      <ClipActionsToolbar
        content={{
          type: 'text',
          text: 'sample',
          metadata: {},
          clip: { id: 'clip-1' } as never,
        }}
      />
    )

    await user.hover(screen.getByRole('button'))

    const tooltip = await screen.findByRole('tooltip', { hidden: true })
    expect(tooltip.parentElement).toHaveClass('text-gray-900')
    expect(tooltip.parentElement).toHaveClass('bg-white/95')
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
