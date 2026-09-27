import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ExtensionJobStatusIcon, jobStatusLabel } from './ExtensionJobStatus'
import { ExtensionOperationIcon } from './ExtensionOperationIcon'

describe('compact extension indicators', () => {
  it('labels running, failed and waiting result states', () => {
    expect(jobStatusLabel({ status: 'running', reasonCode: null })).toBe('Running')
    expect(jobStatusLabel({ status: 'failed', reasonCode: null })).toBe('Failed')
    expect(jobStatusLabel({ status: 'waiting_provider', reasonCode: null })).toBe(
      'Waiting for model'
    )
    expect(jobStatusLabel({ status: 'waiting_write_review', reasonCode: null })).toBe(
      'Needs delivery review'
    )
    const { container } = render(
      <ExtensionJobStatusIcon job={{ status: 'running', reasonCode: null }} />
    )
    expect(container.querySelector('svg')).toHaveClass('animate-spin')
  })
  it('bounds both supplied icons and fallback marks to the same slot', () => {
    const operation = {
      id: 'x',
      packageId: 'x',
      label: 'Ask ChatGPT',
      kind: 'action' as const,
      icon: null,
      iconSvg: 'data:image/svg+xml,<svg/>',
      iconSvgDark: null,
      iconScale: 1.85,
    }
    const { container, rerender } = render(<ExtensionOperationIcon operation={operation} />)
    expect(container.firstChild).toHaveClass('h-4', 'w-4', 'overflow-hidden')
    rerender(<ExtensionOperationIcon operation={{ ...operation, iconSvg: null }} />)
    expect(container.firstChild).toHaveClass('h-4', 'w-4')
  })
})
