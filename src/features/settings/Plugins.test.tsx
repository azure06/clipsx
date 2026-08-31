import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Plugins } from './Plugins'
import type { ExtensionCatalog, PackageDetail } from './extensions/types'

const { mockInvoke } = vi.hoisted(() => ({ mockInvoke: vi.fn() }))

vi.mock('@tauri-apps/api/core', () => ({ invoke: mockInvoke }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => undefined) }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))

const installed = {
  packageId: 'example.tools',
  version: '1.0.0',
  displayName: 'Example tools',
  description: 'Fixture package',
  iconSvg: null,
  iconSvgDark: null,
  source: 'registry' as const,
  enabled: true,
  status: 'ready' as const,
  httpOrigins: [],
  externalNavigationOrigins: [],
  credentialLabels: [],
  providers: [],
  checksum: 'a'.repeat(64),
  settings: [],
}

const registryPackage = {
  packageId: installed.packageId,
  version: installed.version,
  apiVersion: '^2.0',
  displayName: installed.displayName,
  description: installed.description,
  releaseUrl: 'https://example.com/example.clipsx',
  sha256: 'a'.repeat(64),
  contributions: ['Run example'],
  httpOrigins: [],
  externalNavigationOrigins: [],
  credentialLabels: [],
  providers: [],
  categories: ['Tools'],
  tags: [],
}

const catalog: ExtensionCatalog = {
  packages: [
    {
      package: registryPackage,
      installed,
      update: null,
      autoUpdateEligible: false,
      revoked: false,
    },
  ],
  registry: { schemaVersion: 3, cached: true, lastSuccessfulCheckAt: null, error: null },
}

const packageDetail = (shortcut: string | null): PackageDetail => ({
  installed,
  package: registryPackage,
  actions: [
    {
      id: 'example.tools/run',
      packageId: installed.packageId,
      label: 'Run example',
      placements: ['action_menu'],
      available: true,
      unavailableReason: null,
      shortcut,
      pinned: false,
    },
  ],
  settings: {},
  credentials: [],
  update: null,
  autoUpdateMode: 'inherit',
  autoUpdateEligible: false,
  grantsRevokedOnUpdate: true,
  diagnostics: [],
  revoked: false,
})

describe('extension action shortcuts', () => {
  beforeEach(() => {
    let shortcut: string | null = 'Ctrl+K'
    mockInvoke.mockReset()
    mockInvoke.mockImplementation((command: string, args?: Record<string, unknown>) => {
      switch (command) {
        case 'get_extension_catalog':
        case 'check_extension_updates':
          return Promise.resolve(catalog)
        case 'list_core_utilities':
          return Promise.resolve([])
        case 'get_extension_developer_mode':
        case 'get_extension_auto_updates_enabled':
          return Promise.resolve(false)
        case 'get_extension_package_detail':
          return Promise.resolve(packageDetail(shortcut))
        case 'set_extension_action_shortcut':
          shortcut = (args?.['accelerator'] as string | null) ?? null
          return Promise.resolve()
        default:
          return Promise.resolve()
      }
    })
  })

  it('stays on Actions while removing an assigned shortcut', async () => {
    render(<Plugins />)

    fireEvent.click(await screen.findByRole('button', { name: /Example tools/i }))
    const actionsTab = await screen.findByRole('tab', { name: 'Actions' })
    fireEvent.click(actionsTab)

    const remove = screen.getByRole('button', {
      name: 'Remove shortcut',
    })
    fireEvent.click(remove)

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith('set_extension_action_shortcut', {
        actionId: 'example.tools/run',
        accelerator: null,
      })
    )
    await waitFor(() => expect(actionsTab).toHaveAttribute('aria-selected', 'true'))
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Remove shortcut' })).not.toBeInTheDocument()
    )
  })
})
