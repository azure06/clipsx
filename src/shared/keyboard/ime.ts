export const createImeTracker = (delayMs = 100) => {
  let composing = false
  let timer: ReturnType<typeof setTimeout> | undefined
  return {
    start() {
      if (timer) clearTimeout(timer)
      composing = true
    },
    end() {
      timer = setTimeout(() => {
        composing = false
        timer = undefined
      }, delayMs)
    },
    dispose() {
      if (timer) clearTimeout(timer)
    },
    get active() {
      return composing
    },
  }
}
