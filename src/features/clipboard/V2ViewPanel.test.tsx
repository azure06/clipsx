import type { OcrPresentation } from '../../shared/types/v2'
import type { ViewTabControls } from './V2ViewPanel'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useClipboardStore } from '../../stores/clipboardStore'
import { ExtensionCustomView, V2ViewPanel } from './V2ViewPanel'

const { invokeMock, listenMock, unlistenMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  listenMock: vi.fn(),
  unlistenMock: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))
vi.mock('@tauri-apps/api/event', () => ({ listen: listenMock }))
vi.mock('../../shared/hooks/useTheme', () => ({
  useTheme: () => ({ appliedTheme: 'light' }),
}))

const summary = {
  id: 'clip-1',
  sourceAppName: 'Editor',
  sourceAppId: null,
  capturedAt: 1,
  updatedAt: 1,
  isPinned: false,
  isFavorite: false,
  note: null,
  tags: [],
  historyPreview: {
    leading: { kind: 'host_icon', name: 'text' },
    title: 'canonical text',
    subtitle: null,
    badge: null,
    accessibilityLabel: 'canonical text',
  },
  representationCount: 1,
  primaryPresentationKind: 'text',
  thumbnailAssetId: null,
  hasPlainText: true,
  shareable: true,
}

let artifactListener: ((event: { payload: { clipId: string; sourceId: string } }) => void) | null
let facetListener: ((event: { payload: { clipId: string | null } }) => void) | null

describe('V2ViewPanel resolver boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    artifactListener = null
    facetListener = null
    listenMock.mockImplementation((event: string, callback: never) => {
      if (event === 'clip-artifacts-updated') artifactListener = callback
      if (event === 'clip-facets-updated') facetListener = callback
      return Promise.resolve(unlistenMock)
    })
    invokeMock.mockImplementation((command: string, args?: { rendererId?: string }) => {
      if (command === 'get_clip_detail') {
        return Promise.resolve({
          clip: summary,
          representations: [
            {
              id: 'rep-1',
              formatKey: 'windows:CF_UNICODETEXT',
              canonicalMimeType: 'text/plain',
              nativeType: 'CF_UNICODETEXT',
              storageKind: 'text',
              ordinal: 0,
              capturePriority: 10,
              byteLength: 14,
              textValue: 'canonical text',
              fileReferences: [],
              binaryFileId: null,
              sha256: null,
              capabilityId: 'windows.text.unicode',
              formatFamily: 'text',
            },
          ],
          formatObservations: [],
        })
      }
      if (command === 'get_clip_views') {
        return Promise.resolve({
          clipId: 'clip-1',
          primaryViewId: 'extension-view',
          presentationKind: 'extension',
          facets: [],
          views: [
            {
              id: 'core-view',
              rendererId: 'builtin.text',
              label: 'Text',
              sourceId: 'rep-1',
              mimeType: 'text/plain',
              facetId: null,
              isOriginal: false,
              presentationKind: 'text',
              placement: 'alternate',
            },
            {
              id: 'extension-view',
              rendererId: 'sample.renderer',
              label: 'Extension',
              sourceId: 'rep-1',
              mimeType: 'text/plain',
              facetId: null,
              isOriginal: false,
              presentationKind: 'extension',
              placement: 'primary',
            },
          ],
        })
      }
      if (command === 'render_clip_view' && args?.rendererId === 'sample.renderer') {
        return Promise.reject(new Error('extension failed'))
      }
      if (command === 'render_clip_view' && args?.rendererId === 'builtin.text') {
        return Promise.resolve({ kind: 'text', text: 'canonical text' })
      }
      return Promise.reject(new Error(`unexpected command: ${command}`))
    })
  })

  it('uses primaryViewId, falls back to core, and never starts a transform while opening', async () => {
    render(<V2ViewPanel clipId="clip-1" />)

    expect(await screen.findByText('canonical text')).toBeInTheDocument()
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        'render_clip_view',
        expect.objectContaining({ rendererId: 'sample.renderer' })
      )
      expect(invokeMock).toHaveBeenCalledWith(
        'render_clip_view',
        expect.objectContaining({ rendererId: 'builtin.text' })
      )
    })
  })

  it('refreshes only the render model after artifact completion', async () => {
    render(<V2ViewPanel clipId="clip-1" />)
    expect(await screen.findByText('canonical text')).toBeInTheDocument()
    const detailCalls = invokeMock.mock.calls.filter(
      ([command]) => command === 'get_clip_detail'
    ).length
    const renderCalls = invokeMock.mock.calls.filter(
      ([command]) => command === 'render_clip_view'
    ).length

    act(() => {
      artifactListener?.({ payload: { clipId: 'clip-1', sourceId: 'other-representation' } })
    })
    expect(
      invokeMock.mock.calls.filter(([command]) => command === 'render_clip_view')
    ).toHaveLength(renderCalls)

    act(() => {
      artifactListener?.({ payload: { clipId: 'clip-1', sourceId: 'rep-1' } })
    })
    await waitFor(() => {
      expect(
        invokeMock.mock.calls.filter(([command]) => command === 'render_clip_view').length
      ).toBeGreaterThan(renderCalls)
    })
    expect(invokeMock.mock.calls.filter(([command]) => command === 'get_clip_detail')).toHaveLength(
      detailCalls
    )
  })

  it('reloads detail and views when facets change for this clip or globally', async () => {
    render(<V2ViewPanel clipId="clip-1" />)
    expect(await screen.findByText('canonical text')).toBeInTheDocument()
    const detailCalls = () =>
      invokeMock.mock.calls.filter(([command]) => command === 'get_clip_detail').length
    const initialCalls = detailCalls()

    act(() => facetListener?.({ payload: { clipId: 'another-clip' } }))
    expect(detailCalls()).toBe(initialCalls)

    act(() => facetListener?.({ payload: { clipId: 'clip-1' } }))
    await waitFor(() => expect(detailCalls()).toBeGreaterThan(initialCalls))
    const matchingCalls = detailCalls()

    act(() => facetListener?.({ payload: { clipId: null } }))
    await waitFor(() => expect(detailCalls()).toBeGreaterThan(matchingCalls))
  })

  it('refreshes completed OCR while its extracted-text view is selected', async () => {
    let ocr: OcrPresentation = { state: 'pending' }
    let controls: ViewTabControls | null = null
    invokeMock.mockImplementation((command: string) => {
      if (command === 'get_clip_detail')
        return Promise.resolve({ clip: summary, representations: [], formatObservations: [] })
      if (command === 'get_clip_views')
        return Promise.resolve({
          clipId: 'clip-1',
          primaryViewId: 'image',
          presentationKind: 'image',
          facets: [],
          views: [
            {
              id: 'image',
              rendererId: 'builtin.image',
              label: 'PNG',
              sourceId: 'image-source',
              mimeType: 'image/png',
              capabilityId: 'core.image',
              facetId: null,
              isOriginal: false,
              presentationKind: 'image',
              placement: 'primary',
              purpose: 'faithful',
              matchSpecificity: 200,
              iconSvg: null,
              iconSvgDark: null,
              iconScale: 1,
            },
          ],
        })
      if (command === 'render_clip_view')
        return Promise.resolve({
          kind: 'image',
          source: { kind: 'managed', assetId: 'image-asset' },
          ocr,
        })
      return Promise.resolve(null)
    })
    render(
      <V2ViewPanel
        clipId="clip-1"
        onTabControls={value => {
          controls = value
        }}
      />
    )
    await waitFor(() => expect(controls?.views.some(view => view.label === 'OCR text')).toBe(true))
    act(() => controls?.onTabChange('__ocr__'))
    expect(await screen.findByText('Text recognition is queued…')).toBeInTheDocument()
    ocr = { state: 'ready', text: 'Recognized screenshot text' }
    act(() => artifactListener?.({ payload: { clipId: 'clip-1', sourceId: 'image-source' } }))
    expect(await screen.findByText('Recognized screenshot text')).toBeVisible()
    expect(screen.queryByText('Loading preview…')).not.toBeInTheDocument()
    const callsBeforeReturn = invokeMock.mock.calls.filter(
      ([command]) => command === 'render_clip_view'
    ).length
    act(() => controls?.onTabChange('image'))
    expect(await screen.findByRole('img')).toBeInTheDocument()
    expect(
      invokeMock.mock.calls.filter(([command]) => command === 'render_clip_view')
    ).toHaveLength(callsBeforeReturn)
    act(() => controls?.onTabChange('__ocr__'))
    expect(await screen.findByText('Recognized screenshot text')).toBeVisible()
  })

  it('refreshes automatic selection after saved defaults change', async () => {
    render(<V2ViewPanel clipId="clip-1" />)
    await screen.findByText('canonical text')
    const before = invokeMock.mock.calls.filter(([command]) => command === 'get_clip_views').length
    const callback = listenMock.mock.calls.find(
      ([event]) => event === 'renderer-preferences-updated'
    )?.[1] as (() => void) | undefined
    expect(callback).toBeDefined()
    act(() => {
      callback?.()
    })
    await waitFor(() =>
      expect(
        invokeMock.mock.calls.filter(([command]) => command === 'get_clip_views').length
      ).toBeGreaterThan(before)
    )
  })

  it('ignores a stale render response after the selected clip changes', async () => {
    let resolveOldRender: ((model: { kind: 'text'; text: string }) => void) | undefined
    invokeMock.mockImplementation(
      (command: string, args?: { clipId?: string; rendererId?: string }) => {
        const clipId = args?.clipId ?? 'clip-1'
        if (command === 'get_clip_detail') {
          return Promise.resolve({
            clip: { ...summary, id: clipId },
            representations: [],
            formatObservations: [],
          })
        }
        if (command === 'get_clip_views') {
          return Promise.resolve({
            clipId,
            primaryViewId: 'view',
            presentationKind: 'text',
            facets: [],
            views: [
              {
                id: 'view',
                rendererId: 'builtin.text',
                label: 'Text',
                sourceId: `rep-${clipId}`,
                mimeType: 'text/plain',
                facetId: null,
                isOriginal: false,
                presentationKind: 'text',
                placement: 'primary',
              },
            ],
          })
        }
        if (command === 'render_clip_view' && clipId === 'clip-1') {
          return new Promise(resolve => {
            resolveOldRender = resolve
          })
        }
        if (command === 'render_clip_view') {
          return Promise.resolve({ kind: 'text', text: 'new clip model' })
        }
        return Promise.reject(new Error(`unexpected command: ${command}`))
      }
    )

    const { rerender } = render(<V2ViewPanel clipId="clip-1" />)
    await waitFor(() => expect(resolveOldRender).toBeDefined())
    rerender(<V2ViewPanel clipId="clip-2" />)
    expect(await screen.findByText('new clip model')).toBeInTheDocument()

    act(() => resolveOldRender?.({ kind: 'text', text: 'stale clip model' }))
    expect(screen.queryByText('stale clip model')).not.toBeInTheDocument()
  })

  it('unsubscribes from artifact events on unmount', async () => {
    const { unmount } = render(<V2ViewPanel clipId="clip-1" />)
    expect(await screen.findByText('canonical text')).toBeInTheDocument()
    const callsBeforeUnmount = unlistenMock.mock.calls.length
    unmount()
    expect(unlistenMock.mock.calls.length).toBeGreaterThan(callsBeforeUnmount)
  })

  it('closes inactive custom views, reopens on return, and reports load failures', async () => {
    let stateListener:
      | ((event: {
          payload: {
            token: string
            label: string
            state: 'ready' | 'failed'
            message: string | null
          }
        }) => void)
      | null = null
    listenMock.mockImplementation((event: string, callback: typeof stateListener) => {
      if (event === 'extension-custom-view-state') stateListener = callback
      return Promise.resolve(unlistenMock)
    })
    invokeMock.mockImplementation((command: string) => {
      if (command === 'open_extension_custom_view') {
        return Promise.resolve({ token: 'token-1', label: 'extension-1', entryUrl: 'extension:' })
      }
      if (command === 'close_extension_custom_view' || command === 'sync_extension_custom_view')
        return Promise.resolve()
      return Promise.reject(new Error(`unexpected command: ${command}`))
    })
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    )
    const boundsMock = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 10,
      y: 20,
      width: 640,
      height: 360,
      top: 20,
      right: 650,
      bottom: 380,
      left: 10,
      toJSON: () => ({}),
    })

    const customView = (visible: boolean) => (
      <ExtensionCustomView
        clipId="clip-1"
        visible={visible}
        view={{
          id: 'extension-view',
          rendererId: 'sample.renderer',
          label: 'Sample viewer',
          sourceId: 'rep-1',
          mimeType: 'text/plain',
          capabilityId: 'text.plain',
          facetId: 'sample.facet',
          iconSvg: null,
          iconSvgDark: null,
          iconScale: 1,
          isOriginal: false,
          presentationKind: 'extension_ui',
          purpose: 'structured',
          matchSpecificity: 500,
          placement: 'primary',
        }}
      />
    )
    const mounted = render(customView(true))
    expect(screen.getByText('Loading Sample viewer…')).toBeInTheDocument()
    await waitFor(() => expect(stateListener).not.toBeNull())
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        'open_extension_custom_view',
        expect.objectContaining({ rendererId: 'sample.renderer' })
      )
    )

    const opensBeforeExpand = invokeMock.mock.calls.filter(
      ([command]) => command === 'open_extension_custom_view'
    ).length
    fireEvent.click(screen.getByRole('button', { name: 'Expand preview' }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(
      invokeMock.mock.calls.filter(([command]) => command === 'open_extension_custom_view')
    ).toHaveLength(opensBeforeExpand)
    const escapeCallback = listenMock.mock.calls.find(
      ([name]) => name === 'extension-custom-view-escape'
    )?.[1] as (event: { payload: { token: string; label: string } }) => void
    act(() => escapeCallback({ payload: { token: 'wrong', label: 'extension-1' } }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    act(() => escapeCallback({ payload: { token: 'token-1', label: 'extension-1' } }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(
      invokeMock.mock.calls.filter(([command]) => command === 'open_extension_custom_view')
    ).toHaveLength(opensBeforeExpand)

    mounted.rerender(customView(false))
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('close_extension_custom_view', {
        label: 'extension-1',
        token: 'token-1',
      })
    )
    const opensWhileHidden = invokeMock.mock.calls.filter(
      ([command]) => command === 'open_extension_custom_view'
    ).length
    mounted.rerender(customView(false))
    expect(
      invokeMock.mock.calls.filter(([command]) => command === 'open_extension_custom_view')
    ).toHaveLength(opensWhileHidden)
    mounted.rerender(customView(true))
    await waitFor(() =>
      expect(
        invokeMock.mock.calls.filter(([command]) => command === 'open_extension_custom_view')
      ).toHaveLength(opensWhileHidden + 1)
    )

    act(() => {
      stateListener?.({
        payload: {
          token: 'token-1',
          label: 'extension-1',
          state: 'failed',
          message: 'The bundled script could not load.',
        },
      })
    })

    expect(
      await screen.findByText('This extension view could not be displayed.')
    ).toBeInTheDocument()
    expect(screen.getByText('The bundled script could not load.')).toBeInTheDocument()
    boundsMock.mockRestore()
  })
  it.each([true, false])(
    'uses History staleness only when trackHistorySearch=%s',
    async trackHistorySearch => {
      useClipboardStore.setState({ resultsStale: true })
      let stateListener:
        | ((event: {
            payload: { token: string; label: string; state: string; message: null }
          }) => void)
        | undefined
      listenMock.mockImplementation((event: string, listener: typeof stateListener) => {
        if (event === 'extension-custom-view-state') stateListener = listener
        return Promise.resolve(unlistenMock)
      })
      invokeMock.mockImplementation((command: string) =>
        Promise.resolve(
          command === 'open_extension_custom_view'
            ? { token: 'token', label: 'surface', entryUrl: 'extension:' }
            : undefined
        )
      )
      vi.stubGlobal(
        'ResizeObserver',
        class {
          observe() {}
          disconnect() {}
        }
      )
      const bounds = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
        x: 0,
        y: 0,
        width: 600,
        height: 400,
        top: 0,
        left: 0,
        right: 600,
        bottom: 400,
        toJSON: () => ({}),
      })
      const mounted = render(
        <ExtensionCustomView
          clipId="clip"
          trackHistorySearch={trackHistorySearch}
          view={{
            id: 'view',
            rendererId: 'sample.renderer',
            label: 'Sample',
            sourceId: 'rep',
            mimeType: 'text/plain',
            capabilityId: 'text.plain',
            facetId: null,
            iconSvg: null,
            iconSvgDark: null,
            iconScale: 1,
            isOriginal: true,
            presentationKind: 'extension_ui',
            purpose: 'source',
            matchSpecificity: 0,
            placement: 'primary',
          }}
        />
      )
      await waitFor(() =>
        expect(invokeMock).toHaveBeenCalledWith('open_extension_custom_view', expect.anything())
      )
      act(() => {
        stateListener?.({
          payload: { token: 'token', label: 'surface', state: 'ready', message: null },
        })
        window.dispatchEvent(new CustomEvent('clipsx-host-overlay', { detail: { open: false } }))
      })
      expect(invokeMock).toHaveBeenCalledWith(
        'sync_extension_custom_view',
        expect.objectContaining({ label: 'surface', visible: !trackHistorySearch })
      )
      mounted.unmount()
      bounds.mockRestore()
      useClipboardStore.setState({ resultsStale: false })
    }
  )
})
