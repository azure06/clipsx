import { open } from '@tauri-apps/plugin-shell'
import { ExternalLink } from 'lucide-react'
import { createElement } from 'react'
import type { SmartAction, DetectedContent } from '../types'

export class OpenUrlAction implements SmartAction {
    id = 'open-url'
    label = 'Open Link'
    icon = createElement(ExternalLink, { className: 'w-4 h-4' })
    priority = 100
    shortcut = '⌘+O' // Just metadata for UI

    check(content: DetectedContent): boolean {
        return content.type === 'url'
    }

    async execute(content: DetectedContent): Promise<void> {
        if (content.type === 'url') {
            try {
                await open(content.metadata.url)
            } catch (error) {
                console.error('Failed to open URL:', error)
            }
        }
    }
}
