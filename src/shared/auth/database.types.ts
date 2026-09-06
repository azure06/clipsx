export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  private: {
    Tables: {
      account_entitlements: {
        Row: {
          billing_account_id: string
          created_at: string
          effective_from: string
          grace_until: string | null
          paid_through: string | null
          plan_id: string
          source_subscription_id: string | null
          status: Database['private']['Enums']['account_entitlement_status']
          updated_at: string
        }
        Insert: {
          billing_account_id: string
          created_at?: string
          effective_from?: string
          grace_until?: string | null
          paid_through?: string | null
          plan_id: string
          source_subscription_id?: string | null
          status?: Database['private']['Enums']['account_entitlement_status']
          updated_at?: string
        }
        Update: {
          billing_account_id?: string
          created_at?: string
          effective_from?: string
          grace_until?: string | null
          paid_through?: string | null
          plan_id?: string
          source_subscription_id?: string | null
          status?: Database['private']['Enums']['account_entitlement_status']
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'account_entitlements_billing_account_id_fkey'
            columns: ['billing_account_id']
            isOneToOne: true
            referencedRelation: 'billing_accounts'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'account_entitlements_plan_id_fkey'
            columns: ['plan_id']
            isOneToOne: false
            referencedRelation: 'plans'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'account_entitlements_source_subscription_id_fkey'
            columns: ['source_subscription_id']
            isOneToOne: false
            referencedRelation: 'billing_subscriptions'
            referencedColumns: ['id']
          },
        ]
      }
      ai_allowance_periods: {
        Row: {
          billing_account_id: string
          consumed_units: number
          created_at: string
          grant_idempotency_key: string
          grant_reason: string
          granted_units: number
          id: string
          period_end: string
          period_start: string
          plan_id: string
          source_subscription_item_id: string | null
          updated_at: string
        }
        Insert: {
          billing_account_id: string
          consumed_units?: number
          created_at?: string
          grant_idempotency_key: string
          grant_reason: string
          granted_units: number
          id?: string
          period_end: string
          period_start: string
          plan_id: string
          source_subscription_item_id?: string | null
          updated_at?: string
        }
        Update: {
          billing_account_id?: string
          consumed_units?: number
          created_at?: string
          grant_idempotency_key?: string
          grant_reason?: string
          granted_units?: number
          id?: string
          period_end?: string
          period_start?: string
          plan_id?: string
          source_subscription_item_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'ai_allowance_periods_billing_account_id_fkey'
            columns: ['billing_account_id']
            isOneToOne: false
            referencedRelation: 'billing_accounts'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'ai_allowance_periods_plan_id_fkey'
            columns: ['plan_id']
            isOneToOne: false
            referencedRelation: 'plans'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'ai_allowance_periods_source_subscription_item_id_fkey'
            columns: ['source_subscription_item_id']
            isOneToOne: false
            referencedRelation: 'billing_subscription_items'
            referencedColumns: ['id']
          },
        ]
      }
      ai_usage_events: {
        Row: {
          actor_user_id: string
          allowance_period_id: string
          billing_account_id: string
          created_at: string
          delta_units: number
          id: string
          idempotency_key: string
          kind: Database['private']['Enums']['ai_usage_event_kind']
          occurred_at: string
          updated_at: string
        }
        Insert: {
          actor_user_id: string
          allowance_period_id: string
          billing_account_id: string
          created_at?: string
          delta_units: number
          id?: string
          idempotency_key: string
          kind: Database['private']['Enums']['ai_usage_event_kind']
          occurred_at?: string
          updated_at?: string
        }
        Update: {
          actor_user_id?: string
          allowance_period_id?: string
          billing_account_id?: string
          created_at?: string
          delta_units?: number
          id?: string
          idempotency_key?: string
          kind?: Database['private']['Enums']['ai_usage_event_kind']
          occurred_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'ai_usage_events_allowance_period_id_billing_account_id_fkey'
            columns: ['allowance_period_id', 'billing_account_id']
            isOneToOne: false
            referencedRelation: 'ai_allowance_periods'
            referencedColumns: ['id', 'billing_account_id']
          },
        ]
      }
      billing_accounts: {
        Row: {
          created_at: string
          id: string
          kind: Database['private']['Enums']['billing_account_kind']
          organization_id: string | null
          owner_user_id: string
          status: Database['private']['Enums']['billing_account_status']
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind?: Database['private']['Enums']['billing_account_kind']
          organization_id?: string | null
          owner_user_id: string
          status?: Database['private']['Enums']['billing_account_status']
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: Database['private']['Enums']['billing_account_kind']
          organization_id?: string | null
          owner_user_id?: string
          status?: Database['private']['Enums']['billing_account_status']
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'billing_accounts_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      billing_customers: {
        Row: {
          billing_account_id: string
          created_at: string
          id: string
          livemode: boolean
          stripe_created_at: string | null
          stripe_customer_id: string
          stripe_deleted_at: string | null
          stripe_event_created_at: string | null
          updated_at: string
        }
        Insert: {
          billing_account_id: string
          created_at?: string
          id?: string
          livemode: boolean
          stripe_created_at?: string | null
          stripe_customer_id: string
          stripe_deleted_at?: string | null
          stripe_event_created_at?: string | null
          updated_at?: string
        }
        Update: {
          billing_account_id?: string
          created_at?: string
          id?: string
          livemode?: boolean
          stripe_created_at?: string | null
          stripe_customer_id?: string
          stripe_deleted_at?: string | null
          stripe_event_created_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'billing_customers_billing_account_id_fkey'
            columns: ['billing_account_id']
            isOneToOne: false
            referencedRelation: 'billing_accounts'
            referencedColumns: ['id']
          },
        ]
      }
      billing_invoices: {
        Row: {
          amount_due: number
          amount_paid: number
          billing_account_id: string
          created_at: string
          currency: string
          id: string
          livemode: boolean
          next_payment_attempt: string | null
          paid_at: string | null
          status: string
          stripe_created_at: string | null
          stripe_event_created_at: string | null
          stripe_invoice_id: string
          subscription_id: string | null
          updated_at: string
        }
        Insert: {
          amount_due: number
          amount_paid: number
          billing_account_id: string
          created_at?: string
          currency: string
          id?: string
          livemode: boolean
          next_payment_attempt?: string | null
          paid_at?: string | null
          status: string
          stripe_created_at?: string | null
          stripe_event_created_at?: string | null
          stripe_invoice_id: string
          subscription_id?: string | null
          updated_at?: string
        }
        Update: {
          amount_due?: number
          amount_paid?: number
          billing_account_id?: string
          created_at?: string
          currency?: string
          id?: string
          livemode?: boolean
          next_payment_attempt?: string | null
          paid_at?: string | null
          status?: string
          stripe_created_at?: string | null
          stripe_event_created_at?: string | null
          stripe_invoice_id?: string
          subscription_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'billing_invoices_billing_account_id_fkey'
            columns: ['billing_account_id']
            isOneToOne: false
            referencedRelation: 'billing_accounts'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'billing_invoices_subscription_id_billing_account_id_livemo_fkey'
            columns: ['subscription_id', 'billing_account_id', 'livemode']
            isOneToOne: false
            referencedRelation: 'billing_subscriptions'
            referencedColumns: ['id', 'billing_account_id', 'livemode']
          },
        ]
      }
      billing_prices: {
        Row: {
          active: boolean
          billing_scheme: string
          created_at: string
          currency: string
          id: string
          livemode: boolean
          lookup_key: string | null
          product_id: string
          recurring_interval: string | null
          recurring_interval_count: number | null
          stripe_created_at: string | null
          stripe_event_created_at: string | null
          stripe_price_id: string
          tax_behavior: string | null
          unit_amount: number | null
          updated_at: string
          usage_type: string | null
        }
        Insert: {
          active: boolean
          billing_scheme: string
          created_at?: string
          currency: string
          id?: string
          livemode: boolean
          lookup_key?: string | null
          product_id: string
          recurring_interval?: string | null
          recurring_interval_count?: number | null
          stripe_created_at?: string | null
          stripe_event_created_at?: string | null
          stripe_price_id: string
          tax_behavior?: string | null
          unit_amount?: number | null
          updated_at?: string
          usage_type?: string | null
        }
        Update: {
          active?: boolean
          billing_scheme?: string
          created_at?: string
          currency?: string
          id?: string
          livemode?: boolean
          lookup_key?: string | null
          product_id?: string
          recurring_interval?: string | null
          recurring_interval_count?: number | null
          stripe_created_at?: string | null
          stripe_event_created_at?: string | null
          stripe_price_id?: string
          tax_behavior?: string | null
          unit_amount?: number | null
          updated_at?: string
          usage_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'billing_prices_product_id_livemode_fkey'
            columns: ['product_id', 'livemode']
            isOneToOne: false
            referencedRelation: 'billing_products'
            referencedColumns: ['id', 'livemode']
          },
        ]
      }
      billing_products: {
        Row: {
          active: boolean
          created_at: string
          description: string | null
          id: string
          livemode: boolean
          name: string
          plan_id: string | null
          stripe_created_at: string | null
          stripe_deleted_at: string | null
          stripe_event_created_at: string | null
          stripe_product_id: string
          updated_at: string
        }
        Insert: {
          active: boolean
          created_at?: string
          description?: string | null
          id?: string
          livemode: boolean
          name: string
          plan_id?: string | null
          stripe_created_at?: string | null
          stripe_deleted_at?: string | null
          stripe_event_created_at?: string | null
          stripe_product_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          description?: string | null
          id?: string
          livemode?: boolean
          name?: string
          plan_id?: string | null
          stripe_created_at?: string | null
          stripe_deleted_at?: string | null
          stripe_event_created_at?: string | null
          stripe_product_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'billing_products_plan_id_fkey'
            columns: ['plan_id']
            isOneToOne: false
            referencedRelation: 'plans'
            referencedColumns: ['id']
          },
        ]
      }
      billing_subscription_items: {
        Row: {
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          id: string
          livemode: boolean
          price_id: string
          quantity: number
          stripe_created_at: string | null
          stripe_event_created_at: string | null
          stripe_subscription_item_id: string
          subscription_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          livemode: boolean
          price_id: string
          quantity?: number
          stripe_created_at?: string | null
          stripe_event_created_at?: string | null
          stripe_subscription_item_id: string
          subscription_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          livemode?: boolean
          price_id?: string
          quantity?: number
          stripe_created_at?: string | null
          stripe_event_created_at?: string | null
          stripe_subscription_item_id?: string
          subscription_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'billing_subscription_items_price_id_livemode_fkey'
            columns: ['price_id', 'livemode']
            isOneToOne: false
            referencedRelation: 'billing_prices'
            referencedColumns: ['id', 'livemode']
          },
          {
            foreignKeyName: 'billing_subscription_items_subscription_id_livemode_fkey'
            columns: ['subscription_id', 'livemode']
            isOneToOne: false
            referencedRelation: 'billing_subscriptions'
            referencedColumns: ['id', 'livemode']
          },
        ]
      }
      billing_subscriptions: {
        Row: {
          billing_account_id: string
          billing_cycle_anchor: string | null
          cancel_at: string | null
          cancel_at_period_end: boolean
          canceled_at: string | null
          collection_method: string | null
          created_at: string
          customer_id: string
          ended_at: string | null
          id: string
          latest_stripe_invoice_id: string | null
          livemode: boolean
          pause_collection_behavior: string | null
          pause_collection_resumes_at: string | null
          status: string
          stripe_created_at: string | null
          stripe_event_created_at: string | null
          stripe_subscription_id: string
          trial_end: string | null
          trial_start: string | null
          updated_at: string
        }
        Insert: {
          billing_account_id: string
          billing_cycle_anchor?: string | null
          cancel_at?: string | null
          cancel_at_period_end?: boolean
          canceled_at?: string | null
          collection_method?: string | null
          created_at?: string
          customer_id: string
          ended_at?: string | null
          id?: string
          latest_stripe_invoice_id?: string | null
          livemode: boolean
          pause_collection_behavior?: string | null
          pause_collection_resumes_at?: string | null
          status: string
          stripe_created_at?: string | null
          stripe_event_created_at?: string | null
          stripe_subscription_id: string
          trial_end?: string | null
          trial_start?: string | null
          updated_at?: string
        }
        Update: {
          billing_account_id?: string
          billing_cycle_anchor?: string | null
          cancel_at?: string | null
          cancel_at_period_end?: boolean
          canceled_at?: string | null
          collection_method?: string | null
          created_at?: string
          customer_id?: string
          ended_at?: string | null
          id?: string
          latest_stripe_invoice_id?: string | null
          livemode?: boolean
          pause_collection_behavior?: string | null
          pause_collection_resumes_at?: string | null
          status?: string
          stripe_created_at?: string | null
          stripe_event_created_at?: string | null
          stripe_subscription_id?: string
          trial_end?: string | null
          trial_start?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'billing_subscriptions_billing_account_id_fkey'
            columns: ['billing_account_id']
            isOneToOne: false
            referencedRelation: 'billing_accounts'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'billing_subscriptions_customer_id_billing_account_id_livem_fkey'
            columns: ['customer_id', 'billing_account_id', 'livemode']
            isOneToOne: false
            referencedRelation: 'billing_customers'
            referencedColumns: ['id', 'billing_account_id', 'livemode']
          },
        ]
      }
      billing_webhook_events: {
        Row: {
          attempts: number
          available_at: string
          created_at: string
          event_type: string
          last_attempt_at: string | null
          last_error: string | null
          lease_expires_at: string | null
          livemode: boolean
          locked_at: string | null
          locked_by: string | null
          object_id: string
          object_type: string
          processed_at: string | null
          processing_state: Database['private']['Enums']['billing_webhook_processing_state']
          received_at: string
          stripe_event_created_at: string
          stripe_event_id: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          available_at?: string
          created_at?: string
          event_type: string
          last_attempt_at?: string | null
          last_error?: string | null
          lease_expires_at?: string | null
          livemode: boolean
          locked_at?: string | null
          locked_by?: string | null
          object_id: string
          object_type: string
          processed_at?: string | null
          processing_state?: Database['private']['Enums']['billing_webhook_processing_state']
          received_at?: string
          stripe_event_created_at: string
          stripe_event_id: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          available_at?: string
          created_at?: string
          event_type?: string
          last_attempt_at?: string | null
          last_error?: string | null
          lease_expires_at?: string | null
          livemode?: boolean
          locked_at?: string | null
          locked_by?: string | null
          object_id?: string
          object_type?: string
          processed_at?: string | null
          processing_state?: Database['private']['Enums']['billing_webhook_processing_state']
          received_at?: string
          stripe_event_created_at?: string
          stripe_event_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      organization_memberships: {
        Row: {
          created_at: string
          organization_id: string
          role: Database['private']['Enums']['organization_membership_role']
          status: Database['private']['Enums']['organization_membership_status']
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          organization_id: string
          role?: Database['private']['Enums']['organization_membership_role']
          status?: Database['private']['Enums']['organization_membership_status']
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          organization_id?: string
          role?: Database['private']['Enums']['organization_membership_role']
          status?: Database['private']['Enums']['organization_membership_status']
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'organization_memberships_organization_id_fkey'
            columns: ['organization_id']
            isOneToOne: false
            referencedRelation: 'organizations'
            referencedColumns: ['id']
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          created_by_user_id: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by_user_id: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by_user_id?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      plan_features: {
        Row: {
          created_at: string
          feature_key: string
          plan_id: string
          updated_at: string
          value_jsonb: Json
        }
        Insert: {
          created_at?: string
          feature_key: string
          plan_id: string
          updated_at?: string
          value_jsonb: Json
        }
        Update: {
          created_at?: string
          feature_key?: string
          plan_id?: string
          updated_at?: string
          value_jsonb?: Json
        }
        Relationships: [
          {
            foreignKeyName: 'plan_features_plan_id_fkey'
            columns: ['plan_id']
            isOneToOne: false
            referencedRelation: 'plans'
            referencedColumns: ['id']
          },
        ]
      }
      plans: {
        Row: {
          active: boolean
          code: string
          created_at: string
          display_name: string
          id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          display_name: string
          id?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          display_name?: string
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      vault_device_registration_challenges: {
        Row: {
          account_id: string
          challenge_hash: string
          consumed_at: string | null
          created_at: string
          device_encryption_public_key: string
          expires_at: string
          id: string
          updated_at: string
        }
        Insert: {
          account_id: string
          challenge_hash: string
          consumed_at?: string | null
          created_at?: string
          device_encryption_public_key: string
          expires_at: string
          id?: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          challenge_hash?: string
          consumed_at?: string | null
          created_at?: string
          device_encryption_public_key?: string
          expires_at?: string
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      vault_pending_device_registrations: {
        Row: {
          account_id: string
          capabilities: Json
          created_at: string
          device_id: string
          display_name: string
          encryption_public_key: string
          enrollment_origin: string
          expires_at: string
          platform: string
          proof_hash: string
          proof_payload: string
          proof_signature: string
          protection_profile: string
          sas_commitment: string
          signing_public_key: string
          updated_at: string
        }
        Insert: {
          account_id: string
          capabilities: Json
          created_at?: string
          device_id: string
          display_name: string
          encryption_public_key: string
          enrollment_origin: string
          expires_at?: string
          platform: string
          proof_hash: string
          proof_payload: string
          proof_signature: string
          protection_profile: string
          sas_commitment: string
          signing_public_key: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          capabilities?: Json
          created_at?: string
          device_id?: string
          display_name?: string
          encryption_public_key?: string
          enrollment_origin?: string
          expires_at?: string
          platform?: string
          proof_hash?: string
          proof_payload?: string
          proof_signature?: string
          protection_profile?: string
          sas_commitment?: string
          signing_public_key?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_vault_collection_invitation: {
        Args: {
          p_acceptance_transcript_hash: string
          p_account_id: string
          p_collection_id: string
          p_command_hash: string
          p_command_payload: string
          p_command_signature: string
          p_device_id: string
          p_expected_collection_head: string
          p_invitation_command_hash: string
          p_invitation_id: string
          p_operation_id: string
          p_session_id: string
          p_verification_commitment: string
        }
        Returns: boolean
      }
      add_vault_collection_member_and_rotate_epoch: {
        Args: {
          p_account_id: string
          p_collection_id: string
          p_command_hash: string
          p_command_payload: string
          p_command_signature: string
          p_device_envelopes: Json
          p_device_id: string
          p_expected_collection_head: string
          p_historical_device_envelopes: Json
          p_historical_recovery_envelopes: Json
          p_history_access_from_epoch: number
          p_invitation_id: string
          p_joined_epoch: number
          p_membership_id: string
          p_membership_state_hash: string
          p_operation_id: string
          p_recipient_account_id: string
          p_recipient_set_commitment: string
          p_recovery_envelopes: Json
          p_requested_role: Database['public']['Enums']['vault_member_role']
          p_session_id: string
          p_transition_hash: string
          p_transition_payload: string
          p_transition_signature: string
        }
        Returns: boolean
      }
      append_vault_note_revision: {
        Args: {
          p_account_id: string
          p_ciphertext_hash: string
          p_collection_epoch: number
          p_collection_id: string
          p_command_hash: string
          p_command_payload: string
          p_command_signature: string
          p_content_nonce: string
          p_device_id: string
          p_encrypted_content: string
          p_expected_account_head: string
          p_expected_collection_head: string
          p_expected_previous_revision_hash: string
          p_key_wrap_nonce: string
          p_note_id: string
          p_operation_id: string
          p_revision_hash: string
          p_revision_signature: string
          p_session_id: string
          p_wrapped_revision_key: string
          p_wrapped_revision_key_hash: string
        }
        Returns: boolean
      }
      apply_stripe_webhook_projection: {
        Args: {
          p_event_created_at: string
          p_livemode: boolean
          p_payload: Json
          p_request_id: string
          p_stripe_event_id: string
        }
        Returns: boolean
      }
      authorize_pending_vault_device: {
        Args: {
          p_account_id: string
          p_authorization_payload: string
          p_authorization_payload_hash: string
          p_authorizer_device_id: string
          p_command_hash: string
          p_device_id: string
          p_envelopes: Json
          p_expected_previous_operation_hash: string
          p_operation_id: string
          p_pending_command_hash: string
          p_sas_hash: string
          p_session_id: string
          p_signature: string
        }
        Returns: boolean
      }
      authorize_pending_vault_device_with_recovery: {
        Args: {
          p_account_id: string
          p_authorization_payload: string
          p_authorization_payload_hash: string
          p_command_hash: string
          p_device_id: string
          p_envelopes: Json
          p_expected_previous_operation_hash: string
          p_operation_id: string
          p_pending_command_hash: string
          p_recovery_key_id: string
          p_session_id: string
          p_signature: string
        }
        Returns: boolean
      }
      can_read_vault_collection: {
        Args: { p_account_id: string; p_collection_id: string }
        Returns: boolean
      }
      claim_stripe_webhook_event: {
        Args: {
          p_event_type: string
          p_lease_seconds?: number
          p_livemode: boolean
          p_object_id: string
          p_object_type: string
          p_request_id: string
          p_stripe_event_created_at: string
          p_stripe_event_id: string
        }
        Returns: string
      }
      confirm_vault_collection_invitation: {
        Args: {
          p_acceptance_payload_hash: string
          p_acceptance_transcript_hash: string
          p_account_id: string
          p_collection_id: string
          p_command_hash: string
          p_command_payload: string
          p_command_signature: string
          p_device_id: string
          p_expected_collection_head: string
          p_invitation_id: string
          p_operation_id: string
          p_session_id: string
          p_verification_commitment: string
        }
        Returns: boolean
      }
      consume_vault_device_registration_challenge: {
        Args: {
          p_account_id: string
          p_challenge_id: string
          p_challenge_response_hash: string
          p_device_encryption_public_key: string
        }
        Returns: boolean
      }
      create_vault_collection: {
        Args: {
          p_account_id: string
          p_collection_id: string
          p_command_hash: string
          p_command_payload: string
          p_command_signature: string
          p_device_envelope_ciphertext: string
          p_device_envelope_enc: string
          p_device_envelope_payload: string
          p_device_envelope_signature: string
          p_device_id: string
          p_encrypted_metadata: string
          p_expected_account_head: string
          p_membership_state_hash: string
          p_metadata_nonce: string
          p_operation_id: string
          p_recipient_set_commitment: string
          p_recovery_envelope_ciphertext: string
          p_recovery_envelope_enc: string
          p_recovery_envelope_payload: string
          p_recovery_envelope_signature: string
          p_recovery_key_id: string
          p_session_id: string
          p_transition_hash: string
          p_transition_payload: string
          p_transition_signature: string
        }
        Returns: boolean
      }
      create_vault_collection_invitation: {
        Args: {
          p_account_id: string
          p_collection_id: string
          p_command_hash: string
          p_command_payload: string
          p_command_signature: string
          p_device_id: string
          p_expected_collection_head: string
          p_expires_at: string
          p_invitation_id: string
          p_invitation_key_commitment: string
          p_membership_id: string
          p_operation_id: string
          p_recipient_account_id: string
          p_requested_role: Database['public']['Enums']['vault_member_role']
          p_session_id: string
          p_verification_commitment: string
        }
        Returns: boolean
      }
      delete_vault_note: {
        Args: {
          p_account_id: string
          p_collection_id: string
          p_command_hash: string
          p_command_payload: string
          p_command_signature: string
          p_device_id: string
          p_expected_account_head: string
          p_expected_collection_head: string
          p_expected_revision_hash: string
          p_note_id: string
          p_operation_id: string
          p_session_id: string
        }
        Returns: boolean
      }
      fail_stripe_webhook_event: {
        Args: {
          p_error: string
          p_livemode: boolean
          p_request_id: string
          p_stripe_event_id: string
        }
        Returns: boolean
      }
      read_vault_account_sync_page: {
        Args: {
          p_after: number
          p_anchor: string
          p_collection_id: string
          p_limit: number
          p_requester_account_id: string
          p_requester_session_id: string
          p_target_account_id: string
        }
        Returns: Json
      }
      recompute_account_entitlement: {
        Args: { p_billing_account_id: string }
        Returns: undefined
      }
      register_initial_vault_device: {
        Args: {
          p_account_id: string
          p_authorization_payload: string
          p_authorization_payload_hash: string
          p_capabilities: Json
          p_challenge_id: string
          p_challenge_response_hash: string
          p_command_hash: string
          p_command_payload: string
          p_device_encryption_public_key: string
          p_device_id: string
          p_device_proof_payload: string
          p_device_proof_signature: string
          p_device_signing_public_key: string
          p_display_name: string
          p_enrollment_origin: string
          p_operation_id: string
          p_platform: string
          p_protection_profile: string
          p_recovery_command_signature: string
          p_recovery_encryption_public_key: string
          p_recovery_key_id: string
          p_recovery_signing_public_key: string
          p_session_id: string
        }
        Returns: boolean
      }
      register_pending_vault_device: {
        Args: {
          p_account_id: string
          p_capabilities: Json
          p_challenge_id: string
          p_challenge_response_hash: string
          p_device_encryption_public_key: string
          p_device_id: string
          p_device_signing_public_key: string
          p_display_name: string
          p_enrollment_origin: string
          p_platform: string
          p_proof_hash: string
          p_proof_payload: string
          p_proof_signature: string
          p_protection_profile: string
          p_sas_commitment: string
          p_session_id: string
        }
        Returns: boolean
      }
      remove_vault_collection_member_and_rotate_epoch: {
        Args: {
          p_account_id: string
          p_collection_id: string
          p_command_hash: string
          p_command_payload: string
          p_command_signature: string
          p_device_envelopes: Json
          p_device_id: string
          p_epoch_number: number
          p_expected_collection_head: string
          p_membership_id: string
          p_membership_state_hash: string
          p_operation_id: string
          p_recipient_set_commitment: string
          p_recovery_envelopes: Json
          p_removed_account_id: string
          p_session_id: string
          p_transition_hash: string
          p_transition_payload: string
          p_transition_signature: string
        }
        Returns: boolean
      }
      revoke_vault_device_and_rotate_epochs: {
        Args: {
          p_account_id: string
          p_author_device_id: string
          p_command_hash: string
          p_command_payload: string
          p_expected_previous_operation_hash: string
          p_operation_id: string
          p_reason: string
          p_revoked_device_id: string
          p_rotations: Json
          p_session_id: string
          p_signature: string
        }
        Returns: boolean
      }
      rotate_vault_recovery_root: {
        Args: {
          p_account_id: string
          p_active_device_id: string
          p_active_device_signature: string
          p_authorization_payload: string
          p_command_hash: string
          p_envelopes: Json
          p_expected_previous_operation_hash: string
          p_new_encryption_public_key: string
          p_new_recovery_key_id: string
          p_new_signing_public_key: string
          p_old_recovery_key_id: string
          p_operation_id: string
          p_recovery_signature: string
          p_session_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      account_entitlement_status: 'active' | 'grace' | 'read_only'
      ai_usage_event_kind: 'reserve' | 'settle' | 'refund' | 'adjustment'
      billing_account_kind: 'personal' | 'organization'
      billing_account_status: 'active' | 'closed'
      billing_webhook_processing_state: 'pending' | 'processing' | 'processed' | 'failed'
      organization_membership_role: 'owner' | 'admin' | 'member'
      organization_membership_status: 'active' | 'removed'
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      sync_devices: {
        Row: {
          created_at: string
          device_id: string
          display_name: string
          last_seen_at: string
          revoked_at: string | null
          session_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          device_id: string
          display_name: string
          last_seen_at?: string
          revoked_at?: string | null
          session_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          device_id?: string
          display_name?: string
          last_seen_at?: string
          revoked_at?: string | null
          session_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'sync_devices_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'sync_profiles'
            referencedColumns: ['user_id']
          },
        ]
      }
      sync_profiles: {
        Row: {
          cursor: number
          generation: number
          initialized: boolean
          user_id: string
        }
        Insert: {
          cursor?: number
          generation?: number
          initialized?: boolean
          user_id: string
        }
        Update: {
          cursor?: number
          generation?: number
          initialized?: boolean
          user_id?: string
        }
        Relationships: []
      }
      sync_records: {
        Row: {
          generation: number
          key: string
          kind: string
          payload: Json | null
          revision_counter: number
          revision_physical_ms: number
          server_cursor: number
          source_device_id: string
          tombstone: boolean
          user_id: string
        }
        Insert: {
          generation: number
          key: string
          kind: string
          payload?: Json | null
          revision_counter: number
          revision_physical_ms: number
          server_cursor: number
          source_device_id: string
          tombstone: boolean
          user_id: string
        }
        Update: {
          generation?: number
          key?: string
          kind?: string
          payload?: Json | null
          revision_counter?: number
          revision_physical_ms?: number
          server_cursor?: number
          source_device_id?: string
          tombstone?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'sync_records_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'sync_profiles'
            referencedColumns: ['user_id']
          },
        ]
      }
      vault_account_operations: {
        Row: {
          account_id: string
          author_device_id: string | null
          canonical_payload: string
          created_at: string
          operation_hash: string
          operation_id: string
          operation_type: string
          previous_operation_hash: string | null
          protocol_version: number
          recovery_key_id: string | null
          sequence_number: number
          signature: string
        }
        Insert: {
          account_id: string
          author_device_id?: string | null
          canonical_payload: string
          created_at?: string
          operation_hash: string
          operation_id: string
          operation_type: string
          previous_operation_hash?: string | null
          protocol_version: number
          recovery_key_id?: string | null
          sequence_number: number
          signature: string
        }
        Update: {
          account_id?: string
          author_device_id?: string | null
          canonical_payload?: string
          created_at?: string
          operation_hash?: string
          operation_id?: string
          operation_type?: string
          previous_operation_hash?: string | null
          protocol_version?: number
          recovery_key_id?: string | null
          sequence_number?: number
          signature?: string
        }
        Relationships: [
          {
            foreignKeyName: 'vault_account_operations_author_device_id_fkey'
            columns: ['author_device_id']
            isOneToOne: false
            referencedRelation: 'vault_devices'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'vault_account_operations_recovery_key_id_fkey'
            columns: ['recovery_key_id']
            isOneToOne: false
            referencedRelation: 'vault_recovery_keys'
            referencedColumns: ['id']
          },
        ]
      }
      vault_collection_epochs: {
        Row: {
          algorithm: string
          collection_id: string
          created_at: string
          created_by_device_id: string
          epoch_number: number
          id: string
          key_version: number
          membership_state_hash: string
          previous_epoch_hash: string | null
          protocol_version: number
          recipient_set_commitment: string
          rotation_reason: string
          state: string
          transition_hash: string
          transition_payload: string
          transition_signature: string
        }
        Insert: {
          algorithm?: string
          collection_id: string
          created_at?: string
          created_by_device_id: string
          epoch_number: number
          id?: string
          key_version?: number
          membership_state_hash: string
          previous_epoch_hash?: string | null
          protocol_version?: number
          recipient_set_commitment: string
          rotation_reason: string
          state: string
          transition_hash: string
          transition_payload: string
          transition_signature: string
        }
        Update: {
          algorithm?: string
          collection_id?: string
          created_at?: string
          created_by_device_id?: string
          epoch_number?: number
          id?: string
          key_version?: number
          membership_state_hash?: string
          previous_epoch_hash?: string | null
          protocol_version?: number
          recipient_set_commitment?: string
          rotation_reason?: string
          state?: string
          transition_hash?: string
          transition_payload?: string
          transition_signature?: string
        }
        Relationships: [
          {
            foreignKeyName: 'vault_collection_epochs_collection_id_fkey'
            columns: ['collection_id']
            isOneToOne: false
            referencedRelation: 'vault_collections'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'vault_collection_epochs_created_by_device_id_fkey'
            columns: ['created_by_device_id']
            isOneToOne: false
            referencedRelation: 'vault_devices'
            referencedColumns: ['id']
          },
        ]
      }
      vault_collection_invitations: {
        Row: {
          acceptance_payload: string | null
          acceptance_payload_hash: string | null
          acceptance_signature: string | null
          acceptance_transcript_hash: string | null
          accepted_at: string | null
          accepted_by_device_id: string | null
          collection_id: string
          confirmation_payload: string | null
          confirmation_payload_hash: string | null
          confirmation_signature: string | null
          created_at: string
          expires_at: string
          id: string
          invitation_key_commitment: string
          invitation_operation_hash: string
          invitation_payload: string
          inviter_device_id: string
          inviter_signature: string
          membership_id: string
          recipient_account_id: string
          requested_role: Database['public']['Enums']['vault_member_role']
          status: Database['public']['Enums']['vault_invitation_status']
          verification_commitment: string
          verification_mode: string
        }
        Insert: {
          acceptance_payload?: string | null
          acceptance_payload_hash?: string | null
          acceptance_signature?: string | null
          acceptance_transcript_hash?: string | null
          accepted_at?: string | null
          accepted_by_device_id?: string | null
          collection_id: string
          confirmation_payload?: string | null
          confirmation_payload_hash?: string | null
          confirmation_signature?: string | null
          created_at?: string
          expires_at: string
          id: string
          invitation_key_commitment: string
          invitation_operation_hash: string
          invitation_payload: string
          inviter_device_id: string
          inviter_signature: string
          membership_id: string
          recipient_account_id: string
          requested_role: Database['public']['Enums']['vault_member_role']
          status?: Database['public']['Enums']['vault_invitation_status']
          verification_commitment: string
          verification_mode: string
        }
        Update: {
          acceptance_payload?: string | null
          acceptance_payload_hash?: string | null
          acceptance_signature?: string | null
          acceptance_transcript_hash?: string | null
          accepted_at?: string | null
          accepted_by_device_id?: string | null
          collection_id?: string
          confirmation_payload?: string | null
          confirmation_payload_hash?: string | null
          confirmation_signature?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          invitation_key_commitment?: string
          invitation_operation_hash?: string
          invitation_payload?: string
          inviter_device_id?: string
          inviter_signature?: string
          membership_id?: string
          recipient_account_id?: string
          requested_role?: Database['public']['Enums']['vault_member_role']
          status?: Database['public']['Enums']['vault_invitation_status']
          verification_commitment?: string
          verification_mode?: string
        }
        Relationships: [
          {
            foreignKeyName: 'vault_collection_invitations_accepted_by_device_id_fkey'
            columns: ['accepted_by_device_id']
            isOneToOne: false
            referencedRelation: 'vault_devices'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'vault_collection_invitations_collection_id_fkey'
            columns: ['collection_id']
            isOneToOne: false
            referencedRelation: 'vault_collections'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'vault_collection_invitations_inviter_device_id_fkey'
            columns: ['inviter_device_id']
            isOneToOne: false
            referencedRelation: 'vault_devices'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'vault_collection_invitations_membership_id_fkey'
            columns: ['membership_id']
            isOneToOne: true
            referencedRelation: 'vault_collection_memberships'
            referencedColumns: ['id']
          },
        ]
      }
      vault_collection_memberships: {
        Row: {
          account_id: string
          collection_id: string
          history_access_from_epoch: number
          id: string
          invited_by_device_id: string | null
          joined_at: string | null
          joined_epoch: number
          membership_operation_id: string
          removed_at: string | null
          removed_epoch: number | null
          role: Database['public']['Enums']['vault_member_role']
          status: Database['public']['Enums']['vault_member_status']
        }
        Insert: {
          account_id: string
          collection_id: string
          history_access_from_epoch: number
          id?: string
          invited_by_device_id?: string | null
          joined_at?: string | null
          joined_epoch: number
          membership_operation_id: string
          removed_at?: string | null
          removed_epoch?: number | null
          role: Database['public']['Enums']['vault_member_role']
          status: Database['public']['Enums']['vault_member_status']
        }
        Update: {
          account_id?: string
          collection_id?: string
          history_access_from_epoch?: number
          id?: string
          invited_by_device_id?: string | null
          joined_at?: string | null
          joined_epoch?: number
          membership_operation_id?: string
          removed_at?: string | null
          removed_epoch?: number | null
          role?: Database['public']['Enums']['vault_member_role']
          status?: Database['public']['Enums']['vault_member_status']
        }
        Relationships: [
          {
            foreignKeyName: 'vault_collection_memberships_collection_id_fkey'
            columns: ['collection_id']
            isOneToOne: false
            referencedRelation: 'vault_collections'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'vault_collection_memberships_invited_by_device_id_fkey'
            columns: ['invited_by_device_id']
            isOneToOne: false
            referencedRelation: 'vault_devices'
            referencedColumns: ['id']
          },
        ]
      }
      vault_collection_operations: {
        Row: {
          author_device_id: string | null
          canonical_payload: string
          collection_id: string
          created_at: string
          operation_hash: string
          operation_id: string
          operation_type: string
          previous_operation_hash: string | null
          protocol_version: number
          recovery_key_id: string | null
          sequence_number: number
          signature: string
        }
        Insert: {
          author_device_id?: string | null
          canonical_payload: string
          collection_id: string
          created_at?: string
          operation_hash: string
          operation_id: string
          operation_type: string
          previous_operation_hash?: string | null
          protocol_version: number
          recovery_key_id?: string | null
          sequence_number: number
          signature: string
        }
        Update: {
          author_device_id?: string | null
          canonical_payload?: string
          collection_id?: string
          created_at?: string
          operation_hash?: string
          operation_id?: string
          operation_type?: string
          previous_operation_hash?: string | null
          protocol_version?: number
          recovery_key_id?: string | null
          sequence_number?: number
          signature?: string
        }
        Relationships: [
          {
            foreignKeyName: 'vault_collection_operations_author_device_id_fkey'
            columns: ['author_device_id']
            isOneToOne: false
            referencedRelation: 'vault_devices'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'vault_collection_operations_collection_id_fkey'
            columns: ['collection_id']
            isOneToOne: false
            referencedRelation: 'vault_collections'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'vault_collection_operations_recovery_key_id_fkey'
            columns: ['recovery_key_id']
            isOneToOne: false
            referencedRelation: 'vault_recovery_keys'
            referencedColumns: ['id']
          },
        ]
      }
      vault_collections: {
        Row: {
          associated_data_version: number
          created_at: string
          crypto_format: string
          current_epoch_number: number
          current_epoch_transition_hash: string | null
          deleted_at: string | null
          encrypted_metadata: string | null
          id: string
          membership_log_head_hash: string | null
          metadata_algorithm: string
          metadata_key_version: number
          metadata_nonce: string | null
          migration_state: string
          owner_account_id: string
        }
        Insert: {
          associated_data_version?: number
          created_at?: string
          crypto_format?: string
          current_epoch_number?: number
          current_epoch_transition_hash?: string | null
          deleted_at?: string | null
          encrypted_metadata?: string | null
          id?: string
          membership_log_head_hash?: string | null
          metadata_algorithm?: string
          metadata_key_version?: number
          metadata_nonce?: string | null
          migration_state?: string
          owner_account_id: string
        }
        Update: {
          associated_data_version?: number
          created_at?: string
          crypto_format?: string
          current_epoch_number?: number
          current_epoch_transition_hash?: string | null
          deleted_at?: string | null
          encrypted_metadata?: string | null
          id?: string
          membership_log_head_hash?: string | null
          metadata_algorithm?: string
          metadata_key_version?: number
          metadata_nonce?: string | null
          migration_state?: string
          owner_account_id?: string
        }
        Relationships: []
      }
      vault_device_authorizations: {
        Row: {
          account_id: string
          authorization_method: string
          authorization_payload: string
          authorization_payload_hash: string
          authorized_by_device_id: string | null
          created_at: string
          device_id: string
          id: string
          proof_of_possession_payload: string
          proof_of_possession_signature: string
          recovery_key_id: string | null
          signature: string
        }
        Insert: {
          account_id: string
          authorization_method: string
          authorization_payload: string
          authorization_payload_hash: string
          authorized_by_device_id?: string | null
          created_at?: string
          device_id: string
          id?: string
          proof_of_possession_payload: string
          proof_of_possession_signature: string
          recovery_key_id?: string | null
          signature: string
        }
        Update: {
          account_id?: string
          authorization_method?: string
          authorization_payload?: string
          authorization_payload_hash?: string
          authorized_by_device_id?: string | null
          created_at?: string
          device_id?: string
          id?: string
          proof_of_possession_payload?: string
          proof_of_possession_signature?: string
          recovery_key_id?: string | null
          signature?: string
        }
        Relationships: [
          {
            foreignKeyName: 'vault_device_authorizations_authorized_by_device_id_fkey'
            columns: ['authorized_by_device_id']
            isOneToOne: false
            referencedRelation: 'vault_devices'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'vault_device_authorizations_device_id_fkey'
            columns: ['device_id']
            isOneToOne: true
            referencedRelation: 'vault_devices'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'vault_device_authorizations_recovery_key_id_fkey'
            columns: ['recovery_key_id']
            isOneToOne: false
            referencedRelation: 'vault_recovery_keys'
            referencedColumns: ['id']
          },
        ]
      }
      vault_device_epoch_envelopes: {
        Row: {
          algorithm: string
          ciphertext: string
          collection_id: string
          created_at: string
          encapsulation: string
          envelope_payload: string
          envelope_payload_hash: string
          epoch_number: number
          id: string
          key_version: number
          nonce: string | null
          protocol_version: number
          recipient_device_id: string
          sender_device_id: string | null
          sender_recovery_key_id: string | null
          signature: string
        }
        Insert: {
          algorithm: string
          ciphertext: string
          collection_id: string
          created_at?: string
          encapsulation: string
          envelope_payload: string
          envelope_payload_hash: string
          epoch_number: number
          id?: string
          key_version: number
          nonce?: string | null
          protocol_version: number
          recipient_device_id: string
          sender_device_id?: string | null
          sender_recovery_key_id?: string | null
          signature: string
        }
        Update: {
          algorithm?: string
          ciphertext?: string
          collection_id?: string
          created_at?: string
          encapsulation?: string
          envelope_payload?: string
          envelope_payload_hash?: string
          epoch_number?: number
          id?: string
          key_version?: number
          nonce?: string | null
          protocol_version?: number
          recipient_device_id?: string
          sender_device_id?: string | null
          sender_recovery_key_id?: string | null
          signature?: string
        }
        Relationships: [
          {
            foreignKeyName: 'vault_device_epoch_envelopes_collection_id_epoch_number_fkey'
            columns: ['collection_id', 'epoch_number']
            isOneToOne: false
            referencedRelation: 'vault_collection_epochs'
            referencedColumns: ['collection_id', 'epoch_number']
          },
          {
            foreignKeyName: 'vault_device_epoch_envelopes_collection_id_fkey'
            columns: ['collection_id']
            isOneToOne: false
            referencedRelation: 'vault_collections'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'vault_device_epoch_envelopes_recipient_device_id_fkey'
            columns: ['recipient_device_id']
            isOneToOne: false
            referencedRelation: 'vault_devices'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'vault_device_epoch_envelopes_sender_device_id_fkey'
            columns: ['sender_device_id']
            isOneToOne: false
            referencedRelation: 'vault_devices'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'vault_device_epoch_envelopes_sender_recovery_key_id_fkey'
            columns: ['sender_recovery_key_id']
            isOneToOne: false
            referencedRelation: 'vault_recovery_keys'
            referencedColumns: ['id']
          },
        ]
      }
      vault_devices: {
        Row: {
          account_id: string
          client_crypto_capabilities: Json
          client_type: string
          created_at: string
          display_name: string
          encryption_algorithm: string
          encryption_public_key: string
          enrollment_origin: string
          id: string
          key_protection_profile: string
          key_version: number
          last_seen_at: string | null
          platform: string
          revocation_reason: string | null
          revoked_at: string | null
          signing_algorithm: string
          signing_public_key: string
          status: Database['public']['Enums']['vault_device_status']
        }
        Insert: {
          account_id: string
          client_crypto_capabilities: Json
          client_type: string
          created_at?: string
          display_name: string
          encryption_algorithm: string
          encryption_public_key: string
          enrollment_origin: string
          id?: string
          key_protection_profile: string
          key_version: number
          last_seen_at?: string | null
          platform: string
          revocation_reason?: string | null
          revoked_at?: string | null
          signing_algorithm: string
          signing_public_key: string
          status?: Database['public']['Enums']['vault_device_status']
        }
        Update: {
          account_id?: string
          client_crypto_capabilities?: Json
          client_type?: string
          created_at?: string
          display_name?: string
          encryption_algorithm?: string
          encryption_public_key?: string
          enrollment_origin?: string
          id?: string
          key_protection_profile?: string
          key_version?: number
          last_seen_at?: string | null
          platform?: string
          revocation_reason?: string | null
          revoked_at?: string | null
          signing_algorithm?: string
          signing_public_key?: string
          status?: Database['public']['Enums']['vault_device_status']
        }
        Relationships: []
      }
      vault_note_revisions: {
        Row: {
          associated_data_version: number
          author_device_id: string
          author_signature: string
          ciphertext_hash: string
          collection_epoch: number
          collection_id: string
          content_nonce: string
          created_at: string
          encrypted_content: string
          encryption_algorithm: string
          id: string
          key_version: number
          key_wrap_algorithm: string
          key_wrap_nonce: string
          logical_clock: number
          note_id: string
          operation_id: string
          operation_type: string
          previous_revision_hash: string | null
          protocol_version: number
          revision_hash: string
          revision_number: number
          wrapped_revision_key: string
          wrapped_revision_key_hash: string
        }
        Insert: {
          associated_data_version: number
          author_device_id: string
          author_signature: string
          ciphertext_hash: string
          collection_epoch: number
          collection_id: string
          content_nonce: string
          created_at?: string
          encrypted_content: string
          encryption_algorithm?: string
          id?: string
          key_version: number
          key_wrap_algorithm?: string
          key_wrap_nonce: string
          logical_clock: number
          note_id: string
          operation_id: string
          operation_type: string
          previous_revision_hash?: string | null
          protocol_version: number
          revision_hash: string
          revision_number: number
          wrapped_revision_key: string
          wrapped_revision_key_hash: string
        }
        Update: {
          associated_data_version?: number
          author_device_id?: string
          author_signature?: string
          ciphertext_hash?: string
          collection_epoch?: number
          collection_id?: string
          content_nonce?: string
          created_at?: string
          encrypted_content?: string
          encryption_algorithm?: string
          id?: string
          key_version?: number
          key_wrap_algorithm?: string
          key_wrap_nonce?: string
          logical_clock?: number
          note_id?: string
          operation_id?: string
          operation_type?: string
          previous_revision_hash?: string | null
          protocol_version?: number
          revision_hash?: string
          revision_number?: number
          wrapped_revision_key?: string
          wrapped_revision_key_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: 'vault_note_revisions_author_device_id_fkey'
            columns: ['author_device_id']
            isOneToOne: false
            referencedRelation: 'vault_devices'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'vault_note_revisions_collection_id_collection_epoch_fkey'
            columns: ['collection_id', 'collection_epoch']
            isOneToOne: false
            referencedRelation: 'vault_collection_epochs'
            referencedColumns: ['collection_id', 'epoch_number']
          },
          {
            foreignKeyName: 'vault_note_revisions_collection_id_fkey'
            columns: ['collection_id']
            isOneToOne: false
            referencedRelation: 'vault_collections'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'vault_note_revisions_note_id_fkey'
            columns: ['note_id']
            isOneToOne: false
            referencedRelation: 'vault_notes'
            referencedColumns: ['id']
          },
        ]
      }
      vault_notes: {
        Row: {
          collection_id: string
          created_at: string
          created_by_device_id: string
          current_revision: number
          current_revision_hash: string | null
          deleted_at: string | null
          id: string
        }
        Insert: {
          collection_id: string
          created_at?: string
          created_by_device_id: string
          current_revision?: number
          current_revision_hash?: string | null
          deleted_at?: string | null
          id?: string
        }
        Update: {
          collection_id?: string
          created_at?: string
          created_by_device_id?: string
          current_revision?: number
          current_revision_hash?: string | null
          deleted_at?: string | null
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'vault_notes_collection_id_fkey'
            columns: ['collection_id']
            isOneToOne: false
            referencedRelation: 'vault_collections'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'vault_notes_created_by_device_id_fkey'
            columns: ['created_by_device_id']
            isOneToOne: false
            referencedRelation: 'vault_devices'
            referencedColumns: ['id']
          },
        ]
      }
      vault_recovery_epoch_envelopes: {
        Row: {
          algorithm: string
          ciphertext: string
          collection_id: string
          created_at: string
          encapsulation: string
          envelope_payload: string
          envelope_payload_hash: string
          epoch_number: number
          id: string
          key_version: number
          nonce: string | null
          protocol_version: number
          recovery_key_id: string
          sender_device_id: string | null
          sender_recovery_key_id: string | null
          signature: string
        }
        Insert: {
          algorithm: string
          ciphertext: string
          collection_id: string
          created_at?: string
          encapsulation: string
          envelope_payload: string
          envelope_payload_hash: string
          epoch_number: number
          id?: string
          key_version: number
          nonce?: string | null
          protocol_version: number
          recovery_key_id: string
          sender_device_id?: string | null
          sender_recovery_key_id?: string | null
          signature: string
        }
        Update: {
          algorithm?: string
          ciphertext?: string
          collection_id?: string
          created_at?: string
          encapsulation?: string
          envelope_payload?: string
          envelope_payload_hash?: string
          epoch_number?: number
          id?: string
          key_version?: number
          nonce?: string | null
          protocol_version?: number
          recovery_key_id?: string
          sender_device_id?: string | null
          sender_recovery_key_id?: string | null
          signature?: string
        }
        Relationships: [
          {
            foreignKeyName: 'vault_recovery_epoch_envelopes_collection_id_epoch_number_fkey'
            columns: ['collection_id', 'epoch_number']
            isOneToOne: false
            referencedRelation: 'vault_collection_epochs'
            referencedColumns: ['collection_id', 'epoch_number']
          },
          {
            foreignKeyName: 'vault_recovery_epoch_envelopes_recovery_key_id_fkey'
            columns: ['recovery_key_id']
            isOneToOne: false
            referencedRelation: 'vault_recovery_keys'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'vault_recovery_epoch_envelopes_sender_device_id_fkey'
            columns: ['sender_device_id']
            isOneToOne: false
            referencedRelation: 'vault_devices'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'vault_recovery_epoch_envelopes_sender_recovery_key_id_fkey'
            columns: ['sender_recovery_key_id']
            isOneToOne: false
            referencedRelation: 'vault_recovery_keys'
            referencedColumns: ['id']
          },
        ]
      }
      vault_recovery_keys: {
        Row: {
          account_id: string
          authorization_payload: string
          authorization_signature: string
          created_at: string
          encryption_public_key: string
          id: string
          key_version: number
          revoked_at: string | null
          signing_public_key: string
          status: string
        }
        Insert: {
          account_id: string
          authorization_payload: string
          authorization_signature: string
          created_at?: string
          encryption_public_key: string
          id?: string
          key_version: number
          revoked_at?: string | null
          signing_public_key: string
          status: string
        }
        Update: {
          account_id?: string
          authorization_payload?: string
          authorization_signature?: string
          created_at?: string
          encryption_public_key?: string
          id?: string
          key_version?: number
          revoked_at?: string | null
          signing_public_key?: string
          status?: string
        }
        Relationships: []
      }
      vault_tombstones: {
        Row: {
          collection_id: string
          delete_operation_id: string
          deleted_at: string
          deleted_by_device_id: string
          last_revision_hash: string
          note_id: string
        }
        Insert: {
          collection_id: string
          delete_operation_id: string
          deleted_at?: string
          deleted_by_device_id: string
          last_revision_hash: string
          note_id: string
        }
        Update: {
          collection_id?: string
          delete_operation_id?: string
          deleted_at?: string
          deleted_by_device_id?: string
          last_revision_hash?: string
          note_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'vault_tombstones_collection_id_fkey'
            columns: ['collection_id']
            isOneToOne: false
            referencedRelation: 'vault_collections'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'vault_tombstones_delete_operation_id_fkey'
            columns: ['delete_operation_id']
            isOneToOne: true
            referencedRelation: 'vault_collection_operations'
            referencedColumns: ['operation_id']
          },
          {
            foreignKeyName: 'vault_tombstones_deleted_by_device_id_fkey'
            columns: ['deleted_by_device_id']
            isOneToOne: false
            referencedRelation: 'vault_devices'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'vault_tombstones_note_id_fkey'
            columns: ['note_id']
            isOneToOne: true
            referencedRelation: 'vault_notes'
            referencedColumns: ['id']
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      sync_apply_batch: {
        Args: {
          p_after_cursor: number
          p_device_id: string
          p_generation: number
          p_protocol_version: number
          p_records: Json
        }
        Returns: Json
      }
      sync_enroll_device: {
        Args: { p_device_id: string; p_device_name: string }
        Returns: Json
      }
      sync_list_devices: { Args: never; Returns: Json }
      sync_replace_profile: {
        Args: {
          p_device_id: string
          p_generation: number
          p_records: Json
          p_replace: boolean
        }
        Returns: number
      }
      sync_reset_profile: { Args: { p_generation: number }; Returns: number }
      sync_revoke_device: { Args: { p_device_id: string }; Returns: undefined }
    }
    Enums: {
      vault_device_status: 'pending' | 'active' | 'revoked'
      vault_invitation_status: 'created' | 'accepted' | 'expired' | 'cancelled'
      vault_member_role: 'owner' | 'editor' | 'viewer'
      vault_member_status: 'invited' | 'active' | 'removed'
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema['Enums']
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema['CompositeTypes']
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  private: {
    Enums: {
      account_entitlement_status: ['active', 'grace', 'read_only'],
      ai_usage_event_kind: ['reserve', 'settle', 'refund', 'adjustment'],
      billing_account_kind: ['personal', 'organization'],
      billing_account_status: ['active', 'closed'],
      billing_webhook_processing_state: ['pending', 'processing', 'processed', 'failed'],
      organization_membership_role: ['owner', 'admin', 'member'],
      organization_membership_status: ['active', 'removed'],
    },
  },
  public: {
    Enums: {
      vault_device_status: ['pending', 'active', 'revoked'],
      vault_invitation_status: ['created', 'accepted', 'expired', 'cancelled'],
      vault_member_role: ['owner', 'editor', 'viewer'],
      vault_member_status: ['invited', 'active', 'removed'],
    },
  },
} as const
