export type StartupStatus = {
  state:
    | 'ready'
    | 'legacy_reset_required'
    | 'unsupported_schema'
    | 'newer_schema'
    | 'migration_changed'
    | 'missing_migration'
    | 'incomplete_migration'
    | 'startup_failed'
  message: string
  migrationVersion?: number | null
  resetAvailable: boolean
}

export type FactoryResetResult = {
  deleted: string[]
  failures: string[]
  restartRequired: boolean
}
