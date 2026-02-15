import type { ReactNode } from 'react'

// --- 1. Content Types ---
export type ContentType =
    | 'text'        // Default plain text
    | 'url'         // Web links
    | 'email'       // Email addresses
    | 'color'       // Color codes
    | 'code'        // Recognized programming code
    | 'path'        // File system paths
    | 'image'       // Bitmap / Image data
    | 'json'        // Valid structured JSON
    | 'csv'         // Comma-separated values
    | 'mermaid'     // Diagram definitions
    | 'sql'         // SQL queries
    | 'unknown'     // Fallback

// --- 2. Detected Content (Discriminated Union) ---
export interface BaseContent {
    originalText: string
    score: number // Confidence 0-1
}

export type DetectedContent =
    | (BaseContent & { type: 'text'; metadata: { wordCount: number; lines: number } })
    | (BaseContent & { type: 'url'; metadata: { url: string; protocol?: string; domain?: string; title?: string } })
    | (BaseContent & { type: 'email'; metadata: { email: string; domain?: string } })
    | (BaseContent & { type: 'color'; metadata: { value: string; hex: string; rgb: string; hsl: string } })
    | (BaseContent & { type: 'code'; metadata: { language: string; lineCount?: number } })
    | (BaseContent & { type: 'path'; metadata: { path: string; exists?: boolean; isDirectory?: boolean } })
    | (BaseContent & { type: 'image'; metadata: { width?: number; height?: number; format?: string; source?: string } })
    | (BaseContent & { type: 'json'; metadata: { object: unknown } })
    | (BaseContent & { type: 'mermaid'; metadata: { valid: boolean } })
    | (BaseContent & { type: 'unknown'; metadata: Record<string, never> })

// --- 3. Smart Actions ---
export type ActionCategory = 'core' | 'transform' | 'dev' | 'ai' | 'external' | 'utility'

export interface SmartAction {
    id: string
    label: string
    icon: ReactNode
    category?: ActionCategory // New: Categorization
    shortcut?: string
    priority?: number

    // Check if applicable
    check(content: DetectedContent): boolean

    // Execution
    execute(content: DetectedContent): Promise<void | DetectedContent> // Allow returning new content
}

export interface ContentDetector {
    id: string
    priority: number
    detect(text: string): Promise<DetectedContent | null>
}
