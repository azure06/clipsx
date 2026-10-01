import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ render: vi.fn(), bootstrap: vi.fn() }))
vi.mock('react-dom/client', () => ({ default: { createRoot: () => ({ render: mocks.render }) } }))
vi.mock('./App', () => ({ default: () => null }))
vi.mock('./shared/telemetry', () => ({
  bootstrapTelemetry: mocks.bootstrap,
  reactErrorHandler: () => vi.fn(),
}))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  document.body.innerHTML = '<div id="root"></div>'
})

it('renders React while telemetry bootstrap is still pending', async () => {
  mocks.bootstrap.mockReturnValue(new Promise(() => {}))
  await import('./main')
  expect(mocks.bootstrap).toHaveBeenCalledOnce()
  expect(mocks.render).toHaveBeenCalledOnce()
})
