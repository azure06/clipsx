import { render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { RecallContext } from './RecallContext'
import type { RecallSourceSnapshot } from './contracts.generated'

const { state, source } = vi.hoisted(() => {
  const source = {
    clip: { id: 'clip', revision: 'r1' },
    text: 'Deployment notes',
    kind: 'captured',
  }
  return {
    source,
    state: {
      thread: {
        isRunning: true,
        messages: [
          { id: 'question', role: 'user', content: [{ type: 'text', text: 'Deployment' }] },
          {
            id: 'answer',
            role: 'assistant',
            content: [],
            metadata: {
              custom: {
                citations: [{ number: 1, clipId: 'clip', revision: 'r1' }],
                initialRetrieval: { state: 'ready', sources: [source] },
              },
            },
          },
        ],
      },
    },
  }
})
vi.mock('@assistant-ui/react', () => ({
  useAuiState: (select: (value: typeof state) => unknown) => select(state),
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('./SavedSource', () => ({
  SavedSource: ({ citation }: { citation: number }) => <div>Source {citation}</div>,
}))

it('shows automatic evidence before snapshot reload, then deduplicates the saved source', () => {
  const props = {
    threadId: 'thread',
    sources: [] as RecallSourceSnapshot[],
    selection: { messageId: null, citation: null, activation: 0 },
    onSelect: vi.fn(),
    open: vi.fn(),
  }
  const view = render(<RecallContext {...props} />)
  expect(screen.getByRole('status')).toHaveTextContent('recallContext.automatic.ready')
  expect(screen.getAllByText('Source 1')).toHaveLength(1)
  const saved: RecallSourceSnapshot = {
    id: 'snapshot',
    messageId: 'answer',
    clipId: 'clip',
    snapshotJson: JSON.stringify(source),
    assetHash: null,
    available: true,
  }
  view.rerender(<RecallContext {...props} sources={[saved]} />)
  expect(screen.getAllByText('Source 1')).toHaveLength(1)
  expect(screen.queryByText('recallContext.found')).not.toBeInTheDocument()
})
