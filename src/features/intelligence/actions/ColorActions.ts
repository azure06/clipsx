import type { SmartAction, DetectedContent } from '../types'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { Palette, Hash, Activity } from 'lucide-react'
import { createElement } from 'react'

export class CopyHexAction implements SmartAction {
    id = 'copy-hex'
    label = 'Copy HEX'
    icon = createElement(Hash, { className: 'w-4 h-4' })
    priority = 80

    check(content: DetectedContent): boolean {
        return content.type === 'color' && !!content.metadata.hex
    }

    async execute(content: DetectedContent): Promise<void> {
        if (content.type === 'color') {
            await writeText(content.metadata.hex)
        }
    }
}

export class CopyRgbAction implements SmartAction {
    id = 'copy-rgb'
    label = 'Copy RGB'
    icon = createElement(Palette, { className: 'w-4 h-4' })
    priority = 75

    check(content: DetectedContent): boolean {
        return content.type === 'color' && !!content.metadata.rgb
    }

    async execute(content: DetectedContent): Promise<void> {
        if (content.type === 'color') {
            await writeText(content.metadata.rgb)
        }
    }
}

export class CopyHslAction implements SmartAction {
    id = 'copy-hsl'
    label = 'Copy HSL'
    icon = createElement(Activity, { className: 'w-4 h-4' })
    priority = 70

    check(content: DetectedContent): boolean {
        return content.type === 'color' && !!content.metadata.hsl
    }

    async execute(content: DetectedContent): Promise<void> {
        if (content.type === 'color') {
            await writeText(content.metadata.hsl)
        }
    }
}
