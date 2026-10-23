import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { DecisionRulesPanel } from './DecisionRulesPanel'
import type { PrivacySettings } from '../recall/contracts.generated'

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))
let settings: PrivacySettings
beforeEach(() => {
  settings = { skipSecrets: false, rules: [] }
  mocks.invoke.mockReset().mockImplementation((command: string) => {
    if (command === 'privacy_settings') return Promise.resolve(structuredClone(settings))
    if (command === 'ai_configuration_export')
      return Promise.resolve({ presets: [], selections: {} })
    if (command === 'privacy_test_rule') return Promise.resolve(0.82)
    return Promise.resolve()
  })
})

it('keeps heuristics available without a model and saves explicit secret exclusion', async () => {
  const user = userEvent.setup()
  render(<DecisionRulesPanel />)
  const toggle = await screen.findByRole('switch', { name: 'Don’t save detected secrets' })
  expect(toggle).not.toBeChecked()
  await user.click(screen.getByText('How checks handle your data'))
  expect(screen.getByText(/a local Ollama server can also route cloud models/)).toBeVisible()
  await user.click(screen.getByText('Don’t save detected secrets', { selector: 'label' }))
  expect(toggle).toBeChecked()
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await screen.findByRole('status')
  expect(mocks.invoke).toHaveBeenCalledWith('privacy_save_settings', {
    settings: { skipSecrets: true, rules: [] },
  })
  expect(mocks.invoke.mock.calls.some(([command]) => command === 'privacy_test_rule')).toBe(false)
})

it('tests an unsaved rule with only the sample and reports the model result', async () => {
  const user = userEvent.setup()
  settings.rules = [
    {
      id: crypto.randomUUID(),
      name: 'Customer privacy',
      question: 'Does this contain confidential customer information?',
      action: 'mark_private',
      tag: null,
      enabled: false,
    },
  ]
  render(<DecisionRulesPanel />)
  await screen.findByDisplayValue('Customer privacy')
  await user.click(screen.getByRole('combobox', { name: 'Rule' }))
  await user.click(screen.getByRole('option', { name: 'Customer privacy' }))
  await user.type(
    screen.getByRole('textbox', { name: 'Sample text' }),
    'Confidential customer contract'
  )
  await user.click(screen.getByRole('button', { name: 'Test rule' }))
  const result = await screen.findByRole('status')
  expect(result).toHaveTextContent('Yes — rule matches')
  expect(result).toHaveTextContent('Would mark this clip private.')
  expect(result).toHaveTextContent('Yes (True): 82%')
  expect(result).toHaveTextContent('No (False): 18%')
  expect(result).toHaveTextContent('not a measure of correctness')
  expect(mocks.invoke).toHaveBeenCalledWith('privacy_test_rule', {
    rule: settings.rules[0],
    text: 'Confidential customer contract',
  })
  expect(mocks.invoke.mock.calls.some(([command]) => command === 'privacy_save_settings')).toBe(
    false
  )
  await user.type(screen.getByRole('textbox', { name: 'Sample text' }), ' updated')
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})

it.each([
  [0.499, 'No — rule does not match', 'This rule would take no action.'],
  [0.5, 'Yes — rule matches', 'Would add the tag “Work”.'],
])('explains the action at the match boundary %s', async (probability, verdict, effect) => {
  const user = userEvent.setup()
  settings.rules = [
    {
      id: crypto.randomUUID(),
      name: 'Work',
      question: 'Is this work related?',
      action: 'tag',
      tag: 'Work',
      enabled: false,
    },
  ]
  mocks.invoke.mockImplementation((command: string) => {
    if (command === 'privacy_settings') return Promise.resolve(settings)
    if (command === 'ai_configuration_export')
      return Promise.resolve({ presets: [], selections: {} })
    if (command === 'privacy_test_rule') return Promise.resolve(probability)
    return Promise.resolve()
  })
  render(<DecisionRulesPanel />)
  await screen.findByRole('textbox', { name: 'Rule name' })
  await user.click(screen.getByRole('combobox', { name: 'Rule' }))
  await user.click(screen.getByRole('option', { name: 'Work' }))
  await user.type(screen.getByRole('textbox', { name: 'Sample text' }), 'Meeting notes')
  await user.click(screen.getByRole('button', { name: 'Test rule' }))
  const result = await screen.findByRole('status')
  expect(result).toHaveTextContent(verdict)
  expect(result).toHaveTextContent(effect)
  if (probability === 0.499) expect(result).toHaveTextContent('Yes (True): 49.9%')
  await user.type(screen.getByRole('textbox', { name: 'Question to evaluate' }), ' Updated?')
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})

it('focuses new rules, validates drafts, and preserves them when saving fails', async () => {
  const user = userEvent.setup()
  render(<DecisionRulesPanel />)
  await user.click(await screen.findByRole('button', { name: 'Add rule' }))
  expect(screen.getByRole('textbox', { name: 'Rule name' })).toHaveFocus()
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  await user.type(screen.getByRole('textbox', { name: 'Rule name' }), 'Private')
  await user.type(
    screen.getByRole('textbox', { name: 'Question to evaluate' }),
    'Is this confidential?'
  )
  mocks.invoke.mockRejectedValueOnce(new Error('storage unavailable'))
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(/Could not complete/)
  expect(screen.getByDisplayValue('Is this confidential?')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Rules saved'))
})

it('offers retry when settings fail to load', async () => {
  const user = userEvent.setup()
  mocks.invoke.mockRejectedValueOnce(new Error('offline'))
  render(<DecisionRulesPanel />)
  await user.click(await screen.findByRole('button', { name: 'Retry' }))
  expect(await screen.findByRole('switch', { name: 'Don’t save detected secrets' })).toBeVisible()
})

it.each([
  ['favorite', 'Add to favorites', 'Would add this clip to favorites.'],
  ['pin', 'Pin', 'Would pin this clip.'],
] as const)(
  'saves and tests the %s action using general decisions',
  async (action, label, effect) => {
    const user = userEvent.setup()
    settings.rules = [
      {
        id: crypto.randomUUID(),
        name: 'Work',
        question: 'Is this work related?',
        action: 'mark_private',
        tag: null,
        enabled: false,
      },
    ]
    render(<DecisionRulesPanel />)
    await screen.findByRole('textbox', { name: 'Rule name' })
    await user.click(screen.getByRole('combobox', { name: 'If yes, then' }))
    await user.click(screen.getByRole('option', { name: label }))
    expect(screen.getByText('Uses the General decisions model.')).toBeVisible()
    expect(screen.queryByRole('textbox', { name: 'Tag name' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(mocks.invoke).toHaveBeenCalledWith('privacy_save_settings', {
      settings: { ...settings, rules: [{ ...settings.rules[0], action }] },
    })
    await user.click(screen.getByRole('combobox', { name: 'Rule' }))
    await user.click(screen.getByRole('option', { name: 'Work' }))
    await user.type(screen.getByRole('textbox', { name: 'Sample text' }), 'Meeting notes')
    await user.click(screen.getByRole('button', { name: 'Test rule' }))
    expect(screen.getAllByRole('status').some(result => result.textContent?.includes(effect))).toBe(
      true
    )
    expect(mocks.invoke).toHaveBeenCalledWith('privacy_test_rule', {
      rule: { ...settings.rules[0], action },
      text: 'Meeting notes',
    })
  }
)
