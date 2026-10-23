import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AutomationEditor, SavedSetupsEditor, type AutomationRule } from './ExtensionConfiguration'
import type { PackageDetail } from '../settings/extensions/types'
const invoke = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke }))
const saved = {
  id: 'technical',
  packageId: 'example',
  transformerId: 'example/rewrite',
  label: 'Technical',
  parameters: { preset: 'custom', instruction: 'Be concise' },
  defaultView: 'result_only' as const,
  revision: 2,
  available: true,
}
const detail: PackageDetail = {
  installed: null,
  package: null,
  actions: [],
  activations: [],
  settings: {},
  credentials: [],
  update: null,
  autoUpdateMode: 'inherit',
  autoUpdateEligible: false,
  grantsRevokedOnUpdate: true,
  diagnostics: [],
  revoked: false,
  automationConsentRequired: false,
  automationPermissions: {
    sourceApplication: false,
    providers: [],
    packageState: false,
    http: [],
    externalWrites: [],
  },
  transformers: [
    {
      id: 'example/rewrite',
      label: 'Rewrite',
      providerAvailable: true,
      defaultView: 'result_only',
      setupSelectorParameter: 'preset',
      parameterSchema: {
        type: 'object',
        properties: {
          preset: { type: 'string', enum: ['business', 'custom'] },
          instruction: { type: 'string', maxLength: 4096 },
        },
        required: ['preset'],
      },
      parameterUi: [
        {
          field: 'instruction',
          label: 'Custom instruction',
          control: 'textarea',
          when: { field: 'preset', equals: 'custom' },
          required: true,
        },
      ],
      setups: [
        { id: 'business', displayName: 'Business', parameters: { preset: 'business' } },
        { id: 'custom', displayName: 'Custom', parameters: { preset: 'custom' } },
      ],
    },
  ],
}
describe('saved setup configuration', () => {
  beforeEach(() => {
    invoke.mockReset()
    invoke.mockImplementation((command: string) =>
      Promise.resolve(
        command === 'list_extension_transform_setups' ? [saved] : { ...saved, revision: 3 }
      )
    )
  })
  it('uses the shared selector and edits a saved setup through its expected revision', async () => {
    const user = userEvent.setup()
    render(
      <SavedSetupsEditor
        packageId="example"
        detail={detail}
        onChanged={vi.fn().mockResolvedValue(undefined)}
      />
    )
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('list_extension_transform_setups'))
    await user.click(screen.getByRole('combobox', { name: 'Setup' }))
    await user.click(await screen.findByRole('option', { name: 'Technical' }))
    expect(screen.queryByLabelText('Preset')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Setup name')).not.toBeInTheDocument()
    const instruction = screen.getByLabelText('Custom instruction')
    await user.clear(instruction)
    await user.type(instruction, 'Be detailed')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        'save_extension_transform_setup',
        expect.objectContaining({
          id: 'technical',
          expectedRevision: 2,
          label: 'Technical',
          parameters: { preset: 'custom', instruction: 'Be detailed' },
        })
      )
    )
  })
  it('asks for a new name only when saving another setup', async () => {
    const user = userEvent.setup()
    render(
      <SavedSetupsEditor
        packageId="example"
        detail={detail}
        onChanged={vi.fn().mockResolvedValue(undefined)}
      />
    )
    await user.click(screen.getByRole('combobox', { name: 'Setup' }))
    await user.click(await screen.findByRole('option', { name: 'Technical' }))
    await user.click(screen.getByRole('button', { name: 'Save as another setup' }))
    await user.type(screen.getByLabelText('Setup name'), 'Technical copy')
    await user.click(screen.getByRole('button', { name: 'Save setup' }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        'save_extension_transform_setup',
        expect.objectContaining({ id: null, expectedRevision: null, label: 'Technical copy' })
      )
    )
  })
})

describe('all copied clips automation', () => {
  it('can save a completed setup without requiring an observed application', async () => {
    invoke.mockReset()
    invoke.mockImplementation((command: string) =>
      Promise.resolve(command === 'get_extension_automation' ? { revision: 0, rules: [] } : [])
    )
    const previous = Object.getOwnPropertyDescriptor(window, 'confirm')
    Object.defineProperty(window, 'confirm', { configurable: true, value: vi.fn(() => true) })
    const user = userEvent.setup()
    render(
      <AutomationEditor
        packageId="example"
        detail={{
          ...detail,
          activations: [{ id: 'on-copy', event: 'clip_created', transformerId: 'rewrite' }],
          transformers: detail.transformers.map(item => ({ ...item, localId: 'rewrite' })),
        }}
        onChanged={() => Promise.resolve()}
      />
    )
    expect(await screen.findByRole('combobox', { name: 'Copied content' })).toHaveTextContent(
      'All copied clips'
    )
    await user.click(screen.getByRole('combobox', { name: 'Automation setup' }))
    await user.click(screen.getByRole('option', { name: 'Business' }))
    await user.click(screen.getByRole('button', { name: 'Add rule' }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        'set_extension_automation',
        expect.objectContaining({
          rules: [
            expect.objectContaining({
              application: null,
              setupKind: 'builtin',
              setupRef: 'business',
              enabled: true,
            }),
          ],
        })
      )
    )
    if (previous) Object.defineProperty(window, 'confirm', previous)
    else Reflect.deleteProperty(window, 'confirm')
  })
})

describe('ordered conditional automation rules', () => {
  let rules: AutomationRule[]
  let revision: number
  const confirm = vi.fn(() => true)
  beforeEach(() => {
    rules = []
    revision = 0
    Object.defineProperty(window, 'confirm', { configurable: true, value: confirm })
    confirm.mockClear()
    invoke.mockReset()
    invoke.mockImplementation((command: string, args?: { rules?: AutomationRule[] }) => {
      if (command === 'get_extension_automation') return Promise.resolve({ revision, rules })
      if (command === 'set_extension_automation') {
        rules = args?.rules ?? []
        revision++
        return Promise.resolve(revision)
      }
      if (command === 'test_extension_automation')
        return Promise.resolve({
          selectedRuleId: rules[0]?.id,
          setupLabel: 'Business',
          evaluations: [{ ruleId: rules[0]?.id, probability: 0.7, matched: true }],
        })
      return Promise.resolve([])
    })
  })
  function editor() {
    render(
      <AutomationEditor
        packageId="example"
        detail={{
          ...detail,
          activations: [{ id: 'on-copy', event: 'clip_created', transformerId: 'rewrite' }],
          transformers: detail.transformers.map(item => ({ ...item, localId: 'rewrite' })),
        }}
        onChanged={() => Promise.resolve()}
      />
    )
  }
  async function chooseSetup(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole('combobox', { name: 'Automation setup' }))
    await user.click(screen.getByRole('option', { name: 'Business' }))
  }
  it('adds multiple rules in the same scope, duplicates disabled, reorders, and deletes', async () => {
    const user = userEvent.setup()
    editor()
    await chooseSetup(user)
    await user.click(screen.getByRole('button', { name: 'Add rule' }))
    await waitFor(() => expect(rules).toHaveLength(1))
    await user.click(screen.getByRole('button', { name: 'Add rule' }))
    await waitFor(() => expect(rules).toHaveLength(2))
    expect(rules[0]?.id).not.toBe(rules[1]?.id)
    expect(rules.map(rule => rule.order)).toEqual([0, 1])
    const first = rules[0]?.id
    await user.click(screen.getByRole('button', { name: 'Move rule 2 up' }))
    await waitFor(() => expect(rules[1]?.id).toBe(first))
    await waitFor(() =>
      expect(document.activeElement?.closest('[data-rule]')?.getAttribute('data-rule')).toBe(
        rules[0]?.id
      )
    )
    await user.click(screen.getAllByRole('button', { name: 'Duplicate' })[0]!)
    await waitFor(() => expect(rules).toHaveLength(3))
    expect(rules[2]?.enabled).toBe(false)
    await user.click(screen.getAllByRole('button', { name: 'Delete automation rule' })[2]!)
    await waitFor(() => expect(rules).toHaveLength(2))
  })
  it('persists a condition with renewed consent and tests samples without generation or saving', async () => {
    const user = userEvent.setup()
    editor()
    await chooseSetup(user)
    await user.click(screen.getByRole('switch', { name: 'Only run when…' }))
    await user.type(
      screen.getByRole('textbox', { name: 'Question to evaluate' }),
      'Is this an email draft?'
    )
    await user.click(screen.getByRole('button', { name: 'Add rule' }))
    await waitFor(() => expect(rules[0]?.conditionQuestion).toBe('Is this an email draft?'))
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('hosted'))
    invoke.mockClear()
    await user.type(
      screen.getByRole('textbox', { name: 'Sample text' }),
      'Hello, please review this draft'
    )
    await user.click(screen.getByRole('button', { name: 'Test rules' }))
    expect(await screen.findByText('Would run: Business')).toBeInTheDocument()
    expect(invoke).toHaveBeenCalledWith(
      'test_extension_automation',
      expect.objectContaining({ text: 'Hello, please review this draft', rules })
    )
    expect(invoke).not.toHaveBeenCalledWith('set_extension_automation', expect.anything())
    expect(invoke.mock.calls.some(([command]) => /enqueue|generate/.test(String(command)))).toBe(
      false
    )
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.clear(screen.getByRole('textbox', { name: 'Question to evaluate' }))
    await user.type(
      screen.getByRole('textbox', { name: 'Question to evaluate' }),
      'Is this a business email?'
    )
    confirm.mockClear()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(rules[0]?.conditionQuestion).toBe('Is this a business email?'))
  })
  it('retains the draft on save failure and supports retry', async () => {
    const user = userEvent.setup()
    editor()
    await chooseSetup(user)
    const implementation = invoke.getMockImplementation()!
    invoke.mockImplementation((command, args) =>
      command === 'set_extension_automation'
        ? Promise.reject(new Error('offline'))
        : (implementation(command, args) as Promise<unknown>)
    )
    await user.click(screen.getByRole('button', { name: 'Add rule' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Your draft is retained')
    expect(screen.getByRole('combobox', { name: 'Automation setup' })).toHaveTextContent('Business')
    invoke.mockImplementation(implementation)
    await user.click(screen.getByRole('button', { name: 'Add rule' }))
    await waitFor(() => expect(rules).toHaveLength(1))
  })
})
