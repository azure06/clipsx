export type StartupStatus = {
  state: 'ready' | 'legacy_reset_required' | 'unsupported_schema'
  message: string
  resetAvailable: boolean
}

export type FactoryResetResult = {
  deleted: string[]
  failures: string[]
  restartRequired: boolean
}
