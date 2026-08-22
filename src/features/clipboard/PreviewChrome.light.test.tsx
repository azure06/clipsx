import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ClipPresentation } from '../../shared/types/v2'
import {
  formatShortcut,
  getDeleteShortcut,
  getPlatform,
  type ShortcutDef,
} from '../../shared/keyboard/shortcuts'
import { ClipActionsToolbar } from './ClipActionsToolbar'
import { ViewTabIcon } from './ClipPreview'
import { TagChips } from './components/TagChips'
import type { ContextAction, TransformControls } from './useTransformState'
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

const textPresentation: ClipPresentation = {
  id: 'clip-1',
  sourceAppName: null,
  sourceAppId: null,
  capturedAt: 1,
  updatedAt: 1,
  isPinned: false,
  isFavorite: false,
  note: null,
  tags: [],
  historyPreview: {
    leading: { kind: 'host_icon', name: 'text' },
    title: 'sample',
    subtitle: null,
    badge: null,
    accessibilityLabel: 'sample',
  },
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
    iconSvg: null,
    iconSvgDark: null,
    iconScale: 1,
  },
  model: { kind: 'text', text: 'sample' },
}

const actionContext = {
  onDelete: vi.fn(),
  onTogglePin: vi.fn(),
  onToggleFavorite: vi.fn(),
}

const extensionAction = (overrides: Partial<ContextAction> = {}): ContextAction => ({
  id: 'ask-ai',
  packageId: 'example.ask-ai',
  label: 'Ask AI',
  icon: null,
  iconSvg: null,
  iconSvgDark: null,
  iconScale: 1,
  placements: ['preview_toolbar', 'action_menu'],
  effects: ['open_https_url'],
  execution: 'local',
  available: true,
  unavailableReason: null,
  parameterSchema: {},
  shortcut: null,
  pinned: false,
  consentRequired: false,
  externalNavigationOrigins: [],
  httpOrigins: [],
  providers: [],
  ...overrides,
})

const transformControls = (overrides: Partial<TransformControls> = {}): TransformControls => ({
  items: [],
  actions: [],
  run: vi.fn(),
  runAction: vi.fn(),
  pinAction: vi.fn(),
  ...overrides,
})

describe('preview chrome light theme styling', () => {
  beforeEach(() => {
    document.documentElement.className = 'light'
    vi.clearAllMocks()
  })

  it('renders renderer-provided light and dark tab icons at the declared scale', () => {
    const { container } = render(
      <ViewTabIcon light="data:image/svg+xml,light" dark="data:image/svg+xml,dark" scale={0.8} />
    )

    const icons = container.querySelectorAll('img')
    expect(icons).toHaveLength(2)
    expect(icons[0]).toHaveAttribute('src', 'data:image/svg+xml,light')
    expect(icons[1]).toHaveAttribute('src', 'data:image/svg+xml,dark')
    expect(icons[0]).toHaveStyle({ transform: 'scale(0.8)' })
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
          historyPreview: {
            leading: { kind: 'host_icon', name: 'text' },
            title: 'sample',
            subtitle: null,
            badge: null,
            accessibilityLabel: 'sample',
          },
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
            iconSvg: null,
            iconSvgDark: null,
            iconScale: 1,
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
          historyPreview: {
            leading: { kind: 'host_icon', name: 'text' },
            title: 'sample',
            subtitle: null,
            badge: null,
            accessibilityLabel: 'sample',
          },
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
            iconSvg: null,
            iconSvgDark: null,
            iconScale: 1,
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
          historyPreview: {
            leading: { kind: 'host_icon', name: 'text' },
            title: 'sample',
            subtitle: null,
            badge: null,
            accessibilityLabel: 'sample',
          },
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
            iconSvg: null,
            iconSvgDark: null,
            iconScale: 1,
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
    expect(tooltip.querySelector('svg')).toHaveClass('fill-white')
  })

  it.each<{ label: string; shortcut: ShortcutDef }>([
    { label: 'Copy', shortcut: { modifiers: ['primary'], key: 'C' } },
    { label: 'Open in Editor', shortcut: { modifiers: ['primary', 'shift'], key: 'O' } },
    { label: 'Favorite', shortcut: { modifiers: ['primary'], key: 'F' } },
    { label: 'Pin / Unpin', shortcut: { modifiers: ['primary'], key: 'P' } },
    { label: 'Delete', shortcut: getDeleteShortcut(getPlatform()) },
  ])('shows the existing shortcut in the $label tooltip', async ({ label, shortcut }) => {
    const user = userEvent.setup()
    render(<ClipActionsToolbar presentation={textPresentation} context={actionContext} />)

    await user.hover(screen.getByRole('button', { name: label }))

    const tooltip = await screen.findByRole('tooltip', { hidden: true })
    expect(tooltip).toHaveTextContent(label)
    expect(tooltip).toHaveTextContent(formatShortcut(shortcut, getPlatform()))
  })

  it('previews the deferred Representations shortcut', async () => {
    const user = userEvent.setup()
    render(
      <ClipActionsToolbar
        presentation={textPresentation}
        context={{ ...actionContext, onShowInspector: vi.fn() }}
      />
    )

    await user.hover(screen.getByRole('button', { name: 'Representations' }))

    const tooltip = await screen.findByRole('tooltip', { hidden: true })
    expect(tooltip).toHaveTextContent('Representations')
    expect(tooltip).toHaveTextContent(
      formatShortcut({ modifiers: ['primary'], key: 'I' }, getPlatform())
    )
  })

  it('previews the deferred Transform shortcut and renders its themed arrow', async () => {
    const user = userEvent.setup()
    render(
      <ClipActionsToolbar
        presentation={textPresentation}
        context={actionContext}
        transformControls={{
          items: [{ id: 'format', label: 'Format', version: '1' }],
          actions: [],
          run: vi.fn(),
          runAction: vi.fn(),
          pinAction: vi.fn(),
        }}
      />
    )

    await user.hover(screen.getByRole('button', { name: 'Transform' }))

    const tooltip = await screen.findByRole('tooltip', { hidden: true })
    expect(tooltip).toHaveTextContent('Transform')
    expect(tooltip).toHaveTextContent(
      formatShortcut({ modifiers: ['primary'], key: 'T' }, getPlatform())
    )
    expect(tooltip.querySelector('svg')).toHaveClass('fill-white')
  })

  it('keeps extension actions out of the Transform menu', async () => {
    const user = userEvent.setup()
    const run = vi.fn()
    const runAction = vi.fn()
    render(
      <ClipActionsToolbar
        presentation={textPresentation}
        context={actionContext}
        transformControls={transformControls({
          items: [{ id: 'format', label: 'Format', version: '1' }],
          actions: [extensionAction()],
          run,
          runAction,
        })}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Transform' }))

    expect(screen.getByRole('menuitem', { name: 'Format' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Ask AI' })).not.toBeInTheDocument()
  })

  it('shows declared and displaced extension actions in the Actions menu', async () => {
    const user = userEvent.setup()
    const runAction = vi.fn()
    render(
      <ClipActionsToolbar
        presentation={textPresentation}
        context={actionContext}
        transformControls={transformControls({
          actions: [
            extensionAction({ id: 'first', label: 'First' }),
            extensionAction({ id: 'second', label: 'Second', placements: ['preview_toolbar'] }),
            extensionAction({ id: 'third', label: 'Third', placements: ['preview_toolbar'] }),
          ],
          runAction,
        })}
      />
    )

    expect(screen.queryByRole('button', { name: 'Transform' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'First' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Second' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Actions' }))

    expect(screen.getByRole('menuitem', { name: 'First' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Third' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Second' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('menuitem', { name: 'Third' }))
    expect(runAction).toHaveBeenCalledWith('third')
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
