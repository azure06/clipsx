import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ParameterForm } from './ParameterForm'
import { cleanParameters, parameterErrors, type ParameterField } from './parameters'
const schema = {
  type: 'object',
  properties: {
    preset: { type: 'string', enum: ['business', 'translate', 'custom'] },
    target_language: { type: 'string', maxLength: 64 },
    custom_instruction: { type: 'string', maxLength: 4096 },
    count: { type: 'integer' },
    enabled: { type: 'boolean' },
  },
  required: ['preset'],
}
const fields: ParameterField[] = [
  { field: 'preset', label: 'Writing style', control: 'select' },
  {
    field: 'target_language',
    label: 'Target language',
    control: 'text',
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
]
function Form() {
  const [values, setValues] = useState<Record<string, unknown>>({ preset: 'business' })
  return (
    <>
      <ParameterForm
        schema={schema}
        fields={fields}
        values={values}
        errors={parameterErrors(schema, fields, values)}
        onChange={setValues}
      />
      <output data-testid="values">{JSON.stringify(values)}</output>
    </>
  )
}
describe('shared parameter form', () => {
  it('uses extension labels and compatible controls, with host fallback labels and violet focus', () => {
    render(<Form />)
    expect(screen.getByRole('combobox', { name: 'Writing style' })).toHaveClass(
      'focus:border-violet-400'
    )
    expect(screen.getByRole('spinbutton', { name: 'Count' })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Enabled' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Target language')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Custom instruction')).not.toBeInTheDocument()
  })
  it('requires visible values and clears inactive fields when the controlling choice changes', () => {
    render(<Form />)
    const preset = screen.getByLabelText('Writing style')
    fireEvent.change(preset, { target: { value: JSON.stringify('custom') } })
    const instruction = screen.getByRole('textbox', { name: 'Custom instruction' })
    expect(instruction.tagName).toBe('TEXTAREA')
    expect(instruction).toHaveAttribute('aria-invalid', 'true')
    expect(instruction).toHaveAccessibleDescription('Custom instruction is required.')
    fireEvent.change(instruction, { target: { value: 'Be concise' } })
    fireEvent.change(preset, { target: { value: JSON.stringify('translate') } })
    expect(screen.queryByLabelText('Custom instruction')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Target language').tagName).toBe('INPUT')
    expect(screen.getByTestId('values')).not.toHaveTextContent('custom_instruction')
  })
  it('uses the same conditional validation for saving and running, without retaining hidden content', () => {
    expect(parameterErrors(schema, fields, { preset: 'translate' })).toEqual({
      target_language: 'Target language is required.',
    })
    expect(
      cleanParameters(schema, fields, {
        preset: 'business',
        target_language: 'French',
        custom_instruction: 'private',
      })
    ).toEqual({ preset: 'business' })
  })
})
