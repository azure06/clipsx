import type { SmartAction, DetectedContent } from '../types'
import { Share2 } from 'lucide-react'
import { createElement } from 'react'

export class ShareAction implements SmartAction {
    id = 'share-content'
    label = 'Share'
    icon = createElement(Share2, { className: 'w-4 h-4' })
    priority = 10

    check(_content: DetectedContent): boolean {
        // Share is a generic action, always available if the browser supports it
        // But typically we put it in "Common Actions" row? 
        // The user asked for it to be restored. If we add it here as a SmartAction,
        // it will appear in the Context Grid if it passes check().
        // Let's make it always available for text/url content.
        return true
    }

    async execute(content: DetectedContent): Promise<void> {
        if (navigator.share) {
            try {
                await navigator.share({
                    title: 'Shared from ClipsX',
                    text: content.originalText,
                    url: content.type === 'url' ? String(content.metadata['url'] || '') : undefined
                })
            } catch (error) {
                console.error('Share failed:', error)
            }
        } else {
            // Fallback? Or maybe just alert
            console.log("Web Share API not supported")
        }
    }
}
