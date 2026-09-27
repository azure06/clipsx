import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SetupConfiguration } from './SetupConfiguration'
import {
  allowSetupChange,
  cleanParameters,
  parameterErrors,
  sameParameters,
  type SavedSetup,
  type TransformerConfiguration,
} from './parameters'

const rewrite: TransformerConfiguration = {
  id: 'example/rewrite',
  label: 'Rewrite',
  providerAvailable: true,
  defaultView: 'result_only',
  setupSelectorParameter: 'preset',
  parameterSchema: {
    type: 'object',
    properties: {
      preset: { type: 'string', enum: ['business', 'casual', 'translate', 'custom'] },
      target_language: { type: 'string', maxLength: 64 },
      custom_instruction: { type: 'string', maxLength: 4096 },
    },
    required: ['preset'],
  },
  parameterUi: [
    { field: 'preset', label: 'Preset', control: 'select' },
    {
      field: 'target_language',
      label: 'Target language',
      when: { field: 'preset', equals: 'translate' },
      required: true,
    },
    {
      field: 'custom_instruction',
      label: 'Custom instruction',
      control: 'textarea',
      when: { field: 'preset', equals: 'custom' },
      required: true,
    },
  ],
  setups: ['business', 'casual', 'translate', 'custom'].map(id => ({
    id,
    displayName: id[0]!.toUpperCase() + id.slice(1),
    parameters: { preset: id },
  })),
}
const saved: SavedSetup = {
  id: 'technical',
  packageId: 'example',
  transformerId: rewrite.id,
  label: 'Technical',
  parameters: { preset: 'custom', custom_instruction: 'Be concise' },
  defaultView: 'compare',
  revision: 2,
  available: true,
}
function Harness({
  initial = 'business',
  transformer = rewrite,
}: {
  initial?: string
  transformer?: TransformerConfiguration
}) {
  const first =
    initial === 'saved:technical'
      ? saved.parameters
      : (transformer.setups.find(item => item.id === initial)?.parameters ?? {})
  const [reference, setReference] = useState(initial)
  const [values, setValues] = useState<Record<string, unknown>>(first)
  const [baseline, setBaseline] = useState(first)
  const [view, setView] = useState<'result_only' | 'compare'>('result_only')
  return (
    <>
      <SetupConfiguration
        transformer={transformer}
        setups={[saved]}
        reference={reference}
        values={values}
        view={view}
        onViewChange={setView}
        errors={parameterErrors(transformer.parameterSchema, transformer.parameterUi ?? [], values)}
        onChange={setValues}
        onSelect={next => {
          if (!allowSetupChange(!sameParameters(values, baseline))) return
          const parameters =
            next === 'saved:technical'
              ? saved.parameters
              : (transformer.setups.find(item => item.id === next)?.parameters ?? {})
          setReference(next)
          setValues(
            cleanParameters(transformer.parameterSchema, transformer.parameterUi ?? [], parameters)
          )
          setBaseline(parameters)
        }}
      />
      <output data-testid="parameters">{JSON.stringify(values)}</output>
    </>
  )
}
const choose = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
  await user.click(screen.getByRole('combobox', { name: 'Setup' }))
  await user.click(await screen.findByRole('option', { name }))
}
describe('setup configuration workspace', () => {
  it('shows one setup choice and conditional fields without a duplicate selector parameter', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    expect(screen.queryByRole('combobox', { name: 'Preset' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Target language')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Custom instruction')).not.toBeInTheDocument()
    await choose(user, 'Casual')
    expect(screen.queryByLabelText('Target language')).not.toBeInTheDocument()
    await choose(user, 'Translate')
    expect(screen.getByLabelText('Target language')).toHaveAttribute('aria-invalid', 'true')
    await choose(user, 'Custom')
    expect(screen.getByLabelText('Custom instruction').tagName).toBe('TEXTAREA')
    expect(screen.getByTestId('parameters')).toHaveTextContent('"preset":"custom"')
  })
  it('shows the defining saved choice as help and confirms before discarding edited values', async () => {
    const user = userEvent.setup()
    render(<Harness initial="saved:technical" />)
    expect(screen.getByRole('combobox', { name: 'Setup' })).toHaveAccessibleDescription(
      'Based on Custom'
    )
    fireEvent.change(screen.getByLabelText('Custom instruction'), {
      target: { value: 'Be detailed' },
    })
    const previous = Object.getOwnPropertyDescriptor(window, 'confirm')
    const confirm = vi.fn().mockReturnValue(false)
    window.confirm = confirm
    await choose(user, 'Business')
    expect(confirm).toHaveBeenCalledOnce()
    expect(screen.getByLabelText('Custom instruction')).toHaveValue('Be detailed')
    confirm.mockReturnValue(true)
    await choose(user, 'Business')
    expect(screen.queryByLabelText('Custom instruction')).not.toBeInTheDocument()
    expect(screen.getByTestId('parameters')).not.toHaveTextContent('custom_instruction')
    if (previous) Object.defineProperty(window, 'confirm', previous)
    else Reflect.deleteProperty(window, 'confirm')
  })
  it('keeps other setup-supplied fields editable for an image converter', () => {
    const image: TransformerConfiguration = {
      id: 'example/image',
      label: 'Image converter',
      providerAvailable: true,
      defaultView: 'result_only',
      setupSelectorParameter: 'format',
      parameterSchema: {
        type: 'object',
        properties: {
          format: { type: 'string', enum: ['webp'] },
          quality: { type: 'integer', minimum: 1, maximum: 100 },
        },
      },
      setups: [
        { id: 'small', displayName: 'Small WebP', parameters: { format: 'webp', quality: 75 } },
      ],
    }
    render(<Harness transformer={image} initial="small" />)
    expect(screen.queryByLabelText('Format')).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Quality' }), {
      target: { value: '85' },
    })
    expect(screen.getByTestId('parameters')).toHaveTextContent('"quality":85')
  })
  it('keeps an ordinary enum visible when no selector binding is declared', () => {
    render(<Harness transformer={{ ...rewrite, setupSelectorParameter: null }} />)
    expect(screen.getByRole('combobox', { name: 'Preset' })).toBeInTheDocument()
  })
})
