import { open } from '@tauri-apps/plugin-shell'
import { Search } from 'lucide-react'
import { createElement } from 'react'
import type { SmartAction, DetectedContent } from '../types'

export class WebSearchAction implements SmartAction {
    id = 'web-search'
    label = 'Search Google'
    icon = createElement(Search, { className: 'w-4 h-4' })
    priority = 10 // Low priority, but always useful for text

    check(content: DetectedContent): boolean {
        // Show for any text that isn't a URL or extremely long
        return content.type === 'text' || content.type === 'code'
    }

    async execute(content: DetectedContent): Promise<void> {
        const query = encodeURIComponent(content.originalText)
        try {
            await open(`https://www.google.com/search?q=${query}`)
        } catch (error) {
            console.error('Failed to open search:', error)
        }
    }
}
