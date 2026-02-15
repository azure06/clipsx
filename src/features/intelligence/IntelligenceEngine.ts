
import type { DetectedContent, SmartAction } from './types'

export class IntelligenceEngine {
    private static instance: IntelligenceEngine
    private actions: SmartAction[] = []

    private constructor() { }

    public static getInstance(): IntelligenceEngine {
        if (!IntelligenceEngine.instance) {
            IntelligenceEngine.instance = new IntelligenceEngine()
        }
        return IntelligenceEngine.instance
    }

    public registerAction(action: SmartAction): void {
        this.actions.push(action)
        // Sort by priority (higher first)
        this.actions.sort((a, b) => (b.priority || 0) - (a.priority || 0))
    }

    public getActionsForContent(content: DetectedContent): SmartAction[] {
        return this.actions.filter(action => action.check(content))
    }
}

// Export singleton for easy access
export const intelligence = IntelligenceEngine.getInstance()
