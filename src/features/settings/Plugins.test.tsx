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

describe('extension installation feedback', () => {
  const availableCatalog: ExtensionCatalog = {
    ...catalog,
    packages: [{ ...catalog.packages[0]!, installed: null }],
  }
  const availableDetail: PackageDetail = {
    ...packageDetail(null),
    installed: null,
    actions: [],
  }

  beforeEach(() => {
    mockInvoke.mockReset()
    mockInvoke.mockImplementation((command: string) => {
      switch (command) {
        case 'get_extension_catalog':
        case 'check_extension_updates':
          return Promise.resolve(availableCatalog)
        case 'list_core_utilities':
          return Promise.resolve([])
        case 'get_extension_developer_mode':
        case 'get_extension_auto_updates_enabled':
          return Promise.resolve(false)
        case 'get_extension_package_detail':
          return Promise.resolve(availableDetail)
        default:
          return Promise.resolve()
      }
    })
  })

  it('keeps the package open and shows an install failure', async () => {
    mockInvoke.mockImplementation((command: string) => {
      if (command === 'install_registry_extension') {
        return Promise.reject(new Error('Package download failed'))
      }
      if (command === 'get_extension_catalog' || command === 'check_extension_updates') {
        return Promise.resolve(availableCatalog)
      }
      if (command === 'get_extension_package_detail') return Promise.resolve(availableDetail)
      if (command === 'list_core_utilities') return Promise.resolve([])
      if (
        command === 'get_extension_developer_mode' ||
        command === 'get_extension_auto_updates_enabled'
      ) {
        return Promise.resolve(false)
      }
      return Promise.resolve()
    })

    render(<Plugins />)
    fireEvent.click(screen.getByRole('button', { name: 'Discover' }))
    fireEvent.click(await screen.findByRole('button', { name: /Example tools/i }))
    fireEvent.click(await screen.findByRole('button', { name: 'Install' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Package download failed')
    expect(screen.getByRole('heading', { name: 'Example tools' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Install' })).toBeEnabled()
  })

  it('prevents duplicate installs while the first request is pending', async () => {
    let resolveInstall: (() => void) | undefined
    const pendingInstall = new Promise<void>(resolve => {
      resolveInstall = resolve
    })
    mockInvoke.mockImplementation((command: string) => {
      if (command === 'install_registry_extension') return pendingInstall
      if (command === 'get_extension_catalog' || command === 'check_extension_updates') {
        return Promise.resolve(availableCatalog)
      }
      if (command === 'get_extension_package_detail') return Promise.resolve(availableDetail)
      if (command === 'list_core_utilities') return Promise.resolve([])
      if (
        command === 'get_extension_developer_mode' ||
        command === 'get_extension_auto_updates_enabled'
      ) {
        return Promise.resolve(false)
      }
      return Promise.resolve()
    })

    render(<Plugins />)
    fireEvent.click(screen.getByRole('button', { name: 'Discover' }))
    fireEvent.click(await screen.findByRole('button', { name: /Example tools/i }))
    const install = await screen.findByRole('button', { name: 'Install' })
    fireEvent.click(install)
    fireEvent.click(install)

    await waitFor(() => expect(install).toBeDisabled())
    expect(
      mockInvoke.mock.calls.filter(([command]) => command === 'install_registry_extension')
    ).toHaveLength(1)
    resolveInstall?.()
    await waitFor(() => expect(install).toBeEnabled())
  })
})
