import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Tabs } from './Tabs'
describe('persistent controlled tabs', () => {
  it('preserves pane contents when the active pane changes', () => {
    const tabs = [
      { id: 'find', label: 'Find', content: <input aria-label="Query" defaultValue="" /> },
      { id: 'chat', label: 'Chat', content: <p>Conversation</p> },
    ]
    const { rerender } = render(<Tabs tabs={tabs} activeTab="find" keepMounted />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Query' }), {
      target: { value: 'saved query' },
    })
    rerender(<Tabs tabs={tabs} activeTab="chat" keepMounted />)
    expect(screen.getByRole('tabpanel', { name: 'Chat' })).toHaveAttribute('data-state', 'active')
    rerender(<Tabs tabs={tabs} activeTab="find" keepMounted />)
    expect(screen.getByRole('textbox', { name: 'Query' })).toHaveValue('saved query')
  })
})
