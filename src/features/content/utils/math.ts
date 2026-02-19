export const safeEval = (expr: string): number | null => {
    // Very strict regex: only numbers, whitespace, and basic operators
    if (!/^[\d\s+\-*/().]+$/.test(expr)) return null
    try {
        // eslint-disable-next-line @typescript-eslint/no-implied-eval, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return
        return new Function(`return ${expr}`)()
    } catch {
        return null
    }
}
