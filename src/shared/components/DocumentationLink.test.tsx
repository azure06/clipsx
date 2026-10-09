import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { DocumentationLink } from './DocumentationLink'
import { getDocumentationUrl } from '../utils/documentation'
import { RecallWorkspace } from '../../features/recall/RecallWorkspace'

const { invokeMock, toastMock } = vi.hoisted(() => ({ invokeMock: vi.fn(), toastMock: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))
vi.mock('../contexts/ToastContext', () => ({ useToast: () => ({ toast: toastMock }) }))

afterEach(async () => {
  vi.resetAllMocks()
  await i18n.changeLanguage('en')
})

describe('contextual documentation help', () => {
  it('keeps the Recall guide available after a temporary session expires', () => {
    render(
      <RecallWorkspace
        turns={[]}
        scopeLabel="All"
        isRunning={false}
        expired
        onCancel={vi.fn()}
        onClear={vi.fn()}
        onFollowUp={vi.fn()}
        onRetry={vi.fn()}
        onApplySources={vi.fn()}
        onSearchAll={vi.fn()}
        onOpenClip={vi.fn()}
      />
    )
    expect(screen.getByRole('button', { name: 'Recall guide' })).toBeEnabled()
  })
  it('keeps stable English and Japanese destinations, including regional languages', () => {
    expect(getDocumentationUrl('recall', 'en')).toBe('https://docs.clipsx.app/recall')
    expect(getDocumentationUrl('meaningSearch', 'ja-JP', 'first-result')).toBe(
      'https://docs.clipsx.app/ja/meaning-search#first-result'
    )
    expect(getDocumentationUrl('localAi', 'fr', 'generation-models')).toBe(
      'https://docs.clipsx.app/local-ai#generation-models'
    )
  })

  it('uses the current app language and only invokes the external-browser command', async () => {
    invokeMock.mockResolvedValue(undefined)
    render(<DocumentationLink guide="localAi" anchor="embedding-models" label="Help" />)
    await act(() => i18n.changeLanguage('ja'))
    fireEvent.click(screen.getByRole('button', { name: 'Help' }))
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledExactlyOnceWith('open_external_url', {
        url: 'https://docs.clipsx.app/ja/local-ai#embedding-models',
      })
    )
  })

  it('reports a localized browser failure with a manual destination and allows retry', async () => {
    await i18n.changeLanguage('ja')
    invokeMock.mockRejectedValue(new Error('browser unavailable'))
    render(<DocumentationLink guide="recall" label="Help" />)
    fireEvent.click(screen.getByRole('button', { name: 'Help' }))
    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith({
        type: 'error',
        title: i18n.t('documentation.openFailed'),
        description: i18n.t('documentation.openManually', {
          url: 'https://docs.clipsx.app/ja/recall',
        }),
      })
    )
    expect(screen.getByRole('button', { name: 'Help' })).toBeEnabled()
    expect(invokeMock).toHaveBeenCalledTimes(1)
  })
})
