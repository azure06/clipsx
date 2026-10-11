import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { EvidenceMarkdown, ToolSearchResults } from './RecallEvidence'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(() => Promise.resolve()) }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}))
vi.mock('../../shared/contexts/ToastContext', () => ({ useToast: () => ({ toast: vi.fn() }) }))

beforeEach(() => vi.clearAllMocks())
describe('Recall evidence presentation', () => {
  it('resolves only references allocated to this answer and never loads model images', () => {
    const citation = { number: 1, clipId: 'verified', revision: 'r1' }
    const open = vi.fn()
    render(
      <EvidenceMarkdown
        text={'Fact [1](#clip-1). Fake [99](#clip-99). ![remote](https://example.com/image.png)'}
        citations={[citation]}
        onCitation={open}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'recallPage.citation' }))
    expect(open).toHaveBeenCalledExactlyOnceWith(citation)
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.queryByRole('img')).toBeNull()
    expect(invoke).not.toHaveBeenCalled()
  })
  it('shows returned candidates with preview and Rust copying before any final answer', () => {
    const open = vi.fn()
    render(
      <ToolSearchResults
        open={open}
        result={{
          items: [
            {
              clip: { id: 'candidate', capturedAt: 1, sourceAppName: 'Editor' },
              snippet: 'Deployment notes',
            },
          ],
          exhaustive: false,
        }}
      />
    )
    expect(screen.getByText('Deployment notes')).toBeInTheDocument()
    expect(screen.getByText('recallPage.retrievalIncomplete')).toBeInTheDocument()
    expect(screen.queryByText('recallPage.inspectedSources')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'recallPage.preview' }))
    expect(open).toHaveBeenCalledExactlyOnceWith('candidate')
    fireEvent.click(screen.getByRole('button', { name: 'recallPage.copy' }))
    expect(invoke).toHaveBeenCalledExactlyOnceWith('execute_clipboard_output', {
      request: { disposition: 'copy', source: { kind: 'original', clipId: 'candidate' } },
    })
  })
  it('renders an honest empty result without implying evidence was inspected', () => {
    render(<ToolSearchResults open={vi.fn()} result={{ items: [], exhaustive: true }} />)
    expect(screen.getByText('recallPage.noMatches')).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })
})
