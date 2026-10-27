import { copyLiteralText } from './clipboardOutput'

/** Selected preview text uses the native plain-text output path. Explicit Copy actions remain separate. */
export function guardPreviewSelectionCopy(
  root: HTMLElement,
  clipId: string,
  onFailure: () => void
): () => void {
  const targets = new Set<Document | HTMLElement>()
  const copy = (event: Event) => {
    if (event.defaultPrevented) return
    const target = event.target as HTMLElement | null
    const document = target?.ownerDocument
    if (!document) return
    let text = ''
    // Input selections do not necessarily appear in document.getSelection().
    if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') {
      const input = target as HTMLInputElement | HTMLTextAreaElement
      if (input instanceof document.defaultView!.HTMLInputElement && input.type === 'password')
        return
      if (input.selectionStart !== null && input.selectionEnd !== null)
        text = input.value.slice(input.selectionStart, input.selectionEnd)
    } else {
      const selection = document.getSelection()
      if (
        document === root.ownerDocument &&
        selection?.anchorNode &&
        !root.contains(selection.anchorNode)
      )
        return
      text = selection?.toString() ?? ''
    }
    if (!text) return
    // Cancel the browser's rich clipboard payload; Rust writes only text/plain.
    event.preventDefault()
    void copyLiteralText(text, clipId).catch(onFailure)
  }
  const attach = (target: Document | HTMLElement) => {
    if (targets.has(target)) return
    targets.add(target)
    target.addEventListener('copy', copy)
  }
  const frameLoaded = (event: Event) => {
    const frame = event.target as HTMLIFrameElement
    if (frame.tagName !== 'IFRAME') return
    try {
      if (frame.contentDocument) attach(frame.contentDocument)
    } catch {
      // Keep opaque/cross-origin frames sandboxed.
    }
  }
  attach(root)
  root.addEventListener('load', frameLoaded, true)
  for (const frame of root.querySelectorAll('iframe'))
    frameLoaded({ target: frame } as unknown as Event)
  return () => {
    root.removeEventListener('load', frameLoaded, true)
    for (const target of targets) target.removeEventListener('copy', copy)
  }
}
