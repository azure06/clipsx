import type { ReactNode } from 'react'
import type { ClipItem } from '../../shared/types'

// Content type detection from backend
export type ContentType =
  | 'text'
  | 'url'
  | 'email'
  | 'color'
  | 'code'
  | 'json'
  | 'csv'
  | 'jwt'
  | 'timestamp'
  | 'secret'
  | 'path'
  | 'image'
  | 'files'
  | 'math'
  | 'phone'
  | 'date'

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
}

// Unified content representation
export type Content = {
  readonly type: ContentType
  readonly text: string
  readonly metadata: ContentMetadata
  readonly clip: ClipItem
}

// Smart action definition
export type ActionCategory = 'core' | 'transform' | 'dev' | 'ai' | 'external' | 'utility'

export type SmartAction = {
  readonly id: string
  readonly label: string
  readonly icon: ReactNode
  readonly category: ActionCategory
  readonly shortcut?: string
  readonly check: (content: Content) => boolean
  readonly execute: (content: Content) => Promise<void> | void
}
