/**
 * Unit tests for the IME composition debounce logic used in ClipboardHistory.
 *
 * The component attaches window compositionstart/compositionend listeners and
 * tracks state in `isComposingRef`. This file tests the debounce invariants
 * directly (without mounting the full component) because ClipboardHistory
 * depends on Tauri APIs that require extensive mocking.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mirror of the exact debounce logic from ClipboardHistory.tsx
// ---------------------------------------------------------------------------

function makeImeTracker() {
  let isComposing = false
  let timer: ReturnType<typeof setTimeout> | null = null

  const onCompositionStart = () => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    isComposing = true
  }

  const onCompositionEnd = () => {
    timer = setTimeout(() => {
      isComposing = false
      timer = null
    }, 100)
  }

  return {
    onCompositionStart,
    onCompositionEnd,
    get isComposing() {
      return isComposing
    },
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('IME composition debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('sets isComposing = true on compositionstart', () => {
    const ime = makeImeTracker()
    ime.onCompositionStart()
    expect(ime.isComposing).toBe(true)
  })

  it('stays true immediately after compositionend', () => {
    const ime = makeImeTracker()
    ime.onCompositionStart()
    ime.onCompositionEnd()
    // Enter keydown arrives synchronously after compositionend — must still be true
    expect(ime.isComposing).toBe(true)
  })

  it('stays true within 100ms after compositionend', () => {
    const ime = makeImeTracker()
    ime.onCompositionStart()
    ime.onCompositionEnd()
    vi.advanceTimersByTime(99)
    expect(ime.isComposing).toBe(true)
  })

  it('resets to false after 100ms', () => {
    const ime = makeImeTracker()
    ime.onCompositionStart()
    ime.onCompositionEnd()
    vi.advanceTimersByTime(100)
    expect(ime.isComposing).toBe(false)
  })

  it('cancels the reset when compositionstart fires within 100ms (rapid segment change)', () => {
    const ime = makeImeTracker()
    // First segment
    ime.onCompositionStart()
    ime.onCompositionEnd()
    vi.advanceTimersByTime(50) // still within the 100ms debounce window
    // macOS fires compositionstart for the next segment — must cancel the reset
    ime.onCompositionStart()
    vi.advanceTimersByTime(200) // well past the original deadline
    expect(ime.isComposing).toBe(true) // still composing, no reset happened
  })

  it('does reset after the debounce when the final compositionend fires', () => {
    const ime = makeImeTracker()
    ime.onCompositionStart()
    ime.onCompositionEnd()
    vi.advanceTimersByTime(50)
    ime.onCompositionStart() // rapid segment
    ime.onCompositionEnd() // final end of session
    vi.advanceTimersByTime(99)
    expect(ime.isComposing).toBe(true)
    vi.advanceTimersByTime(1)
    expect(ime.isComposing).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Cmd+Backspace guard — the isInput check prevents clip deletion while the
// search input has focus. Tests the logic captured in the keyboard handler.
// ---------------------------------------------------------------------------

describe('Cmd+Backspace isInput guard', () => {
  it('should not delete when isInput is true', () => {
    let deleted = false
    const isInput = true

    // Mirror of the keyboard handler case body
    const handleKey = (key: string, metaKey: boolean) => {
      if (key === 'Backspace' || key === 'Delete') {
        if (isInput) return // the guard
        deleted = true
      }
      void metaKey
    }

    handleKey('Backspace', true) // Cmd+Backspace
    expect(deleted).toBe(false)
  })

  it('should delete when isInput is false', () => {
    let deleted = false
    const isInput = false

    const handleKey = (key: string, metaKey: boolean) => {
      if (key === 'Backspace' || key === 'Delete') {
        if (isInput) return
        deleted = true
      }
      void metaKey
    }

    handleKey('Backspace', true)
    expect(deleted).toBe(true)
  })

  it('guard applies to Delete key as well', () => {
    let deleted = false
    const isInput = true

    const handleKey = (key: string) => {
      if (key === 'Backspace' || key === 'Delete') {
        if (isInput) return
        deleted = true
      }
    }

    handleKey('Delete')
    expect(deleted).toBe(false)
  })
})
