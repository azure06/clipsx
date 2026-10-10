import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { SavedSource } from './SavedSource'
import type { RecallSourceSnapshot } from './contracts.generated'
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
const source: RecallSourceSnapshot = {
  id: 'snapshot',
  messageId: 'reply',
  clipId: 'clip',
  snapshotJson: JSON.stringify({ kind: 'ocr', text: '<script>evidence</script>' }),
  available: false,
  assetHash: null,
}
describe('saved clipboard evidence', () => {
  beforeEach(() => vi.clearAllMocks())
  it('retains inert evidence and marks deleted source links unavailable', () => {
    render(<SavedSource source={source} threadId="thread" open={vi.fn()} />)
    expect(screen.getByText('recallPage.missingSource')).toBeInTheDocument()
    expect(screen.getByText('<script>evidence</script>')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'recallPage.openSource' })).toBeNull()
    expect(document.querySelector('script')).toBeNull()
  })
  it('loads a managed image snapshot only after an explicit preview request', async () => {
    vi.mocked(invoke).mockResolvedValue('verified-preview')
    render(
      <SavedSource
        source={{
          ...source,
          available: true,
          assetHash: 'hash',
          snapshotJson: JSON.stringify({ mimeType: 'image/jpeg' }),
        }}
        threadId="thread"
        open={vi.fn()}
      />
    )
    expect(invoke).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'recallPage.preview' }))
    await waitFor(() =>
      expect(screen.getByAltText('recallPage.sourcePreview')).toHaveAttribute(
        'src',
        'data:image/jpeg;base64,verified-preview'
      )
    )
    expect(invoke).toHaveBeenCalledWith('recall_snapshot_image', {
      threadId: 'thread',
      snapshotId: 'snapshot',
    })
  })
})
