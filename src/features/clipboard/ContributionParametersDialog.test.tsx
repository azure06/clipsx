import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ContributionParametersDialog } from './ContributionParametersDialog'
import { schemaHasParameters } from './contributionParameters'

describe('ContributionParametersDialog', () => {
  it('renders declared controls and submits typed values with defaults', () => {
    const onSubmit = vi.fn()
    render(
      <ContributionParametersDialog
        request={{
          kind: 'action',
          id: 'example/action',
          label: 'Ask Local AI',
          schema: {
            type: 'object',
            required: ['instruction'],
            properties: {
              instruction: { type: 'string', title: 'Instruction', default: 'Summarize' },
              output: { type: 'string', enum: ['preview', 'copy'], default: 'preview' },
              count: { type: 'integer', default: 2, minimum: 1, maximum: 5 },
              concise: { type: 'boolean', default: true },
            },
          },
        }}
        onCancel={vi.fn()}
        onSubmit={onSubmit}
      />
    )

    fireEvent.change(screen.getByLabelText(/Instruction/), { target: { value: 'Explain' } })
    fireEvent.change(screen.getByLabelText('count'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))

    expect(onSubmit).toHaveBeenCalledWith({
      instruction: 'Explain',
      output: 'preview',
      count: 3,
      concise: true,
    })
  })

  it('does not prompt for an empty schema', () => {
    expect(schemaHasParameters({ type: 'object', properties: {} })).toBe(false)
  })
})
