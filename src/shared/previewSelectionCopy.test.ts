import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { guardPreviewSelectionCopy } from './previewSelectionCopy'
import { copyLiteralText } from './clipboardOutput'
vi.mock('./clipboardOutput', () => ({ copyLiteralText: vi.fn(() => Promise.resolve()) }))
let dispose = () => {}
beforeEach(() => vi.clearAllMocks())
afterEach(() => {
  dispose()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})
function setup() {
  const root = document.createElement('div')
  root.innerHTML = '<strong>Selected text</strong>'
  document.body.append(root)
  const failure = vi.fn()
  dispose = guardPreviewSelectionCopy(root, 'clip', failure)
  return { root, failure }
}
function selection(document: Document, node: Node, text = 'Selected text') {
  vi.spyOn(document, 'getSelection').mockReturnValue({
    anchorNode: node,
    toString: () => text,
  } as Selection)
}
function copy(target: EventTarget) {
  const event = new Event('copy', { bubbles: true, cancelable: true })
  target.dispatchEvent(event)
  return event
}
it('copies selected formatted text through native plain-text output', () => {
  const { root } = setup()
  selection(document, root.firstChild!)
  expect(copy(root.firstChild!).defaultPrevented).toBe(true)
  expect(copyLiteralText).toHaveBeenCalledWith('Selected text', 'clip')
})
it('leaves empty selections and selections outside the preview alone', () => {
  const { root } = setup()
  selection(document, root, '')
  expect(copy(root).defaultPrevented).toBe(false)
  selection(document, document.body)
  expect(copy(root).defaultPrevented).toBe(false)
  expect(copyLiteralText).not.toHaveBeenCalled()
})
it('uses the selected substring in an editable field', () => {
  const { root } = setup()
  const input = document.createElement('textarea')
  input.value = 'before selected after'
  root.append(input)
  input.setSelectionRange(7, 15)
  expect(copy(input).defaultPrevented).toBe(true)
  expect(copyLiteralText).toHaveBeenCalledWith('selected', 'clip')
})
it('handles same-origin HTML frames and removes listeners on cleanup', () => {
  const { root } = setup()
  const frame = document.createElement('iframe')
  root.append(frame)
  frame.dispatchEvent(new Event('load'))
  const body = frame.contentDocument!.body
  selection(frame.contentDocument!, body, 'HTML selection')
  expect(copy(body).defaultPrevented).toBe(true)
  expect(copyLiteralText).toHaveBeenCalledWith('HTML selection', 'clip')
  dispose()
  expect(copy(body).defaultPrevented).toBe(false)
})
it('reports a failed native copy', async () => {
  const { root, failure } = setup()
  selection(document, root)
  vi.mocked(copyLiteralText).mockRejectedValueOnce(new Error('clipboard unavailable'))
  copy(root)
  await vi.waitFor(() => expect(failure).toHaveBeenCalledOnce())
})
