import { Copy } from 'lucide-react'
import { createElement } from 'react'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import type { SmartAction, DetectedContent } from '../types'

export class CopyAction implements SmartAction {
    id = 'copy-content'
    label = 'Copy'
    icon = createElement(Copy, { className: 'w-4 h-4' })
    priority = 90
    shortcut = '⌘+C'

    check(_content: DetectedContent): boolean {
        return true // Always available
    }

    async execute(content: DetectedContent): Promise<void> {
        try {
            if (content.type === 'color' && content.metadata && content.metadata['value']) {
                await writeText(content.metadata['value'])
            } else {
                await writeText(content.originalText)
            }
        } catch (error) {
            console.error('Failed to copy to clipboard:', error)
        }
    }
}
