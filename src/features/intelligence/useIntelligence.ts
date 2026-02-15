
import { useCallback } from 'react'
import { intelligence } from './IntelligenceEngine'
import type { DetectedContent, SmartAction } from './types'

// Actions
import { OpenUrlAction } from './actions/OpenUrlAction'
import { CopyAction } from './actions/CopyAction'
import { ShareAction } from './actions/ShareAction'
import { CopyHexAction, CopyRgbAction, CopyHslAction } from './actions/ColorActions'
import { SendEmailAction } from './actions/SendEmailAction'
import { WebSearchAction } from './actions/WebSearchAction'
import { CopyHtmlAction } from './actions/CopyHtmlAction'

// Initialize Engine (Singleton) - run once
const initializeEngine = () => {
    // Register Actions
    intelligence.registerAction(new OpenUrlAction())
    intelligence.registerAction(new CopyAction())
    intelligence.registerAction(new ShareAction())
    intelligence.registerAction(new SendEmailAction())
    intelligence.registerAction(new WebSearchAction())
    intelligence.registerAction(new CopyHtmlAction())

    // Color Actions
    intelligence.registerAction(new CopyHexAction())
    intelligence.registerAction(new CopyRgbAction())
    intelligence.registerAction(new CopyHslAction())
}

// Call initialization immediately
initializeEngine()

export const useIntelligence = () => {
    const getActions = useCallback((content: DetectedContent): SmartAction[] => {
        return intelligence.getActionsForContent(content)
    }, [])

    return {
        getActions
    }
}
