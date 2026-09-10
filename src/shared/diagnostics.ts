import { invoke } from '@tauri-apps/api/core'

// No arbitrary strings or error objects cross the diagnostic boundary.
export type DiagnosticEvent =
  | 'auth_deep_link_callback_received'
  | 'auth_deep_link_listener_registered'
  | 'auth_falling_back_to_the_hosted_auth_callback_bridge'
  | 'auth_initial_deep_link_state'
  | 'auth_secure_storage_read'
  | 'auth_secure_storage_remove'
  | 'auth_secure_storage_write'
  | 'auth_supabase_pkce_code_exchange_failed'
  | 'auth_using_local_auth_callback_listener'
  | 'errorboundary_caught_an_error'
  | 'failed_to_close_pending_updater_resource'
  | 'failed_to_initialize_application_language'
  | 'failed_to_reset_settings'
  | 'failed_to_toggle_autostart'
  | 'failed_to_update_tray_language'
  | 'window_unable_to_show_snap_layout'

export const diagnostic = (event: DiagnosticEvent): void => {
  void invoke('write_diagnostic', { event }).catch(() => {
    // Logging must never interrupt the operation being diagnosed.
  })
}
