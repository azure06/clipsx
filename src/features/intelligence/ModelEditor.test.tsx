import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { ModelEditor } from './ModelEditor'
import { emptyConnection, emptyPreset } from './modelConfiguration'

it('uses Auto for new chat presets and preserves saved numbers when toggled', async () => {
  const user = userEvent.setup()
  const connection = emptyConnection()
  const preset = emptyPreset(connection.id)
  preset.contextLimit = 16384
  preset.outputLimit = 3072
  render(
    <ModelEditor
      initial={preset}
      connection={connection}
      busy={false}
      error={null}
      models={[]}
      onDiscover={vi.fn()}
      onSave={vi.fn()}
      onClose={vi.fn()}
    />
  )
  await user.click(screen.getByText('Advanced options'))
  const auto = screen.getByRole('switch', { name: 'Automatic model limits' })
  expect(auto).toBeChecked()
  expect(screen.getByLabelText('Context limit (tokens)')).toBeDisabled()
  await user.click(auto)
  expect(screen.getByLabelText('Context limit (tokens)')).toBeEnabled()
  expect(screen.getByLabelText('Context limit (tokens)')).toHaveValue(16384)
  expect(screen.getByLabelText('Output limit (tokens)')).toHaveValue(3072)
})
