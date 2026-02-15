import { open } from '@tauri-apps/plugin-shell'
import { Mail } from 'lucide-react'
import { createElement } from 'react'
import type { SmartAction, DetectedContent } from '../types'

export class SendEmailAction implements SmartAction {
    id = 'send-email'
    label = 'Send Email'
    icon = createElement(Mail, { className: 'w-4 h-4' })
    priority = 90
    shortcut = 'Cmd+E' // Metadata

    check(content: DetectedContent): boolean {
        return content.type === 'email'
    }

    async execute(content: DetectedContent): Promise<void> {
        if (content.type === 'email') {
            try {
                // Now TS knows content is the Email variant
                await open(`mailto:${content.metadata.email}`)
            } catch (error) {
                console.error('Failed to open mail client:', error)
            }
        }
    }
}
