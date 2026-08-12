import type { ReactNode } from 'react'
import type { ShortcutDef } from '../../shared/keyboard/shortcuts'

// Content type detection from backend
export type ContentType =
  | 'text'
  | 'url'
  | 'email'
  | 'color'
  | 'markdown'
  | 'code'
  | 'json'
  | 'csv'
  | 'jwt'
  | 'timestamp'
  | 'secret'
  | 'path'
  | 'image'
  | 'files'
  | 'office'
  | 'math'
  | 'phone'
  | 'date'

export type FileMetadata = {
  readonly path: string
  readonly name: string
  readonly size: number
  readonly created: number
  readonly modified: number
  readonly error?: string
}

// Parsed metadata from clip.metadata (JSON string from backend)
export type ContentMetadata = {
  readonly url?: string
  readonly domain?: string
  readonly protocol?: string
  readonly email?: string
  readonly hex?: string
  readonly value?: string
  readonly language?: string
  readonly score?: number
  readonly word_count?: number
  readonly line_count?: number
  readonly original?: string

  // New fields
  readonly iso?: string
  readonly unit?: string
  readonly delimiter?: string
  readonly rows?: number
  readonly columns?: number
  readonly format?: string
  readonly files?: FileMetadata[]

  // Office content fields
  readonly svg?: string
  readonly pdf?: string
  readonly attachment_path?: string
  readonly source_app?: string
  readonly office_app?: 'word' | 'excel' | 'powerpoint' | 'office'
  readonly office_kind?: 'spreadsheet' | 'document' | 'slides'
  readonly table_source?: 'html' | 'csv_text' | 'plain_text'
}

// Unified content representation
export type Content = {
  readonly type: ContentType
  readonly text: string
  readonly metadata: ContentMetadata
  readonly clip: PresentationClip
}

export type PresentationClip = {
  readonly [key: string]: unknown
  readonly id: string
  readonly isFavorite: boolean
  readonly isPinned: boolean
  readonly imagePath?: string | null
  readonly contentHtml?: string | null
  readonly ocrText?: string | null
  readonly ocrStatus?: string | null
  readonly appName?: string | null
}

// Smart action definition
export type ActionCategory = 'core' | 'transform' | 'dev' | 'ai' | 'external' | 'utility'

export type ActionPlacement = 'global_bar' | 'preview_inline' | 'preview_menu' | 'hidden'

export type SmartAction = {
  readonly id: string
  readonly label: string
  readonly icon: ReactNode
  readonly category: ActionCategory
  readonly placement: ActionPlacement
  readonly shortcut?: ShortcutDef
  readonly check: (content: Content) => boolean
  readonly execute: (content: Content) => Promise<void> | void
  readonly isActive?: (content: Content) => boolean
}

export interface ActionContext {
  onDelete: (id: string) => void
  onTogglePin: (id: string) => void
  onToggleFavorite: (id: string) => void
}
