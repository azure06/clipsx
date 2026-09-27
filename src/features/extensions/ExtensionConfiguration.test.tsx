import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SavedSetupsEditor } from './ExtensionConfiguration'
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
