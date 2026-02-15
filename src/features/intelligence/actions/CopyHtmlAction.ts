import { writeHtml, writeText } from '@tauri-apps/plugin-clipboard-manager'
import { FileCode } from 'lucide-react'
import { createElement } from 'react'
import type { SmartAction, DetectedContent } from '../types'

export class CopyHtmlAction implements SmartAction {
    id = 'copy-html'
    label = 'Copy as HTML'
    icon = createElement(FileCode, { className: 'w-4 h-4' })
    priority = 5

    check(content: DetectedContent): boolean {
        // Useful for text (sentences) or code
        return content.type === 'text' || content.type === 'code'
    }

    async execute(content: DetectedContent): Promise<void> {
        let html = ''
        if (content.type === 'code') {
            html = `<pre><code>${this.escapeHtml(content.originalText)}</code></pre>`
        } else {
            // Treat as paragraph(s)
            html = content.originalText
                .split('\n')
                .map(line => `<p>${this.escapeHtml(line)}</p>`)
                .join('')
        }

        try {
            // Try explicit HTML write if available (depends on plugin version)
            // If writeHtml is not actually exported at runtime (despite types), fallback.
            // Note: writeHtml might override plain text. 
            // We usually want BOTH. 
            // Tauri v2 clipboard plugin separates writeText and writeHtml.
            // Writing HTML usually clears text unless we assume extended capabilities.
            await writeHtml(html)

            // NOTE: Some apps prefer plain text fallback. 
            // If we writeHtml, we might lose the plain text in some clipboard managers on OS level?
            // For now, satisfy the "Copy as HTML" request.
        } catch (error) {
            console.warn('writeHtml failed, falling back to writing HTML source as text:', error)
            await writeText(html)
        }
    }

    private escapeHtml(text: string): string {
        return text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;")
    }
}
