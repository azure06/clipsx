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

it('keeps unreported hosted model limits editable while Auto is on', async () => {
  const user = userEvent.setup()
  const connection = { ...emptyConnection(), provider: 'openai' as const }
  const preset = emptyPreset(connection.id)
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
  expect(screen.getByRole('switch', { name: 'Automatic model limits' })).toBeChecked()
  expect(screen.getByLabelText('Context limit (tokens)')).toBeEnabled()
  expect(screen.getByLabelText('Context limit (tokens)')).toHaveValue(131072)
  expect(screen.getByLabelText('Output limit (tokens)')).toBeEnabled()
  expect(screen.getByLabelText('Output limit (tokens)')).toHaveValue(8192)
})

it.each(['decision', 'rerank'] as const)(
  'offers reported OpenRouter %s models without mixing in other purposes',
  async purpose => {
    const user = userEvent.setup()
    const connection = { ...emptyConnection(), provider: 'openrouter' as const }
    const preset = { ...emptyPreset(connection.id), purpose, name: 'Specialist' }
    const onSave = vi.fn().mockResolvedValue(undefined)
    const capabilities = emptyPreset(connection.id).capabilities
    render(
      <ModelEditor
        initial={preset}
        connection={connection}
        busy={false}
        error={null}
        models={[
          { id: 'provider/chat', purposes: ['chat'], capabilities },
          { id: 'provider/decision', purposes: ['decision'], capabilities },
          { id: 'provider/rerank', purposes: ['rerank'], capabilities },
          { id: 'provider/unknown', purposes: null, capabilities },
        ]}
        onDiscover={vi.fn()}
        onSave={onSave}
        onClose={vi.fn()}
      />
    )
    await user.click(screen.getByRole('combobox', { name: 'Model' }))
    expect(screen.getByRole('option', { name: `provider/${purpose}` })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'provider/chat' })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'provider/unknown' })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('option', {
        name: `provider/${purpose === 'rerank' ? 'decision' : 'rerank'}`,
      })
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: `provider/${purpose}` }))
    await user.click(screen.getByRole('button', { name: 'Save preset' }))
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        purpose,
        modelId: `provider/${purpose}`,
      })
    )
  }
)
