export const hasNativeSelection = () => {
  const active = document.activeElement
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)
    return active.selectionStart !== active.selectionEnd
  return !(window.getSelection()?.isCollapsed ?? true)
}
