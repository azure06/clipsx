/* eslint-disable @typescript-eslint/no-explicit-any */

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { describe, it, expect } from 'vitest'
import type { Content } from '../types'

// Mock the hooks since they might use window/navigator
// We can use a simple mock strategy or just test the logic if the hooks are pure-ish
// But hooks are functions, so we can't easily mock them inside the component unless we mock the module.
// For now, let's just test the logic by inspecting the registry output if possible.
// Actually, `useActionRegistry` is a hook, so it needs to be run in a component or `renderHook`.

// Since we are using standard Vitest, we might not have `renderHook` from `testing-library/react-hooks` setup.
// Let's assume we can test the `check` functions of the actions mostly.

import { useCalculateAction } from './type-specific/MathActions'
import { useCallPhoneAction } from './type-specific/PhoneActions'
import { useCsvToJsonAction } from './type-specific/CSVActions'

describe('Smart Actions Logic', () => {
  it('Math action checks correctly', () => {
    const action = useCalculateAction()
    const content: Content = {
      type: 'math',
      text: '1 + 1',
      metadata: {},
      clip: {} as any,
    }
    expect(action.check(content)).toBe(true)

    const other: Content = { type: 'text', text: 'abc', metadata: {}, clip: {} as any }
    expect(action.check(other)).toBe(false)
  })

  it('Phone action checks correctly', () => {
    const action = useCallPhoneAction()
    const content: Content = { type: 'phone', text: '123', metadata: {}, clip: {} as any }
    expect(action.check(content)).toBe(true)
  })

  it('CSV action checks correctly', () => {
    const action = useCsvToJsonAction()
    const content: Content = { type: 'csv', text: 'a,b', metadata: {}, clip: {} as any }
    expect(action.check(content)).toBe(true)
  })
})
