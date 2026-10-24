// The host owns page scale. Visual previews consume these events themselves;
// cancelling the default must not stop their handlers from receiving the event.
export function guardPageZoom(target: Window): () => void {
  const wheel = (event: WheelEvent) => {
    if (event.ctrlKey || event.metaKey) event.preventDefault()
  }
  const gesture = (event: Event) => event.preventDefault()
  target.addEventListener('wheel', wheel, { capture: true, passive: false })
  target.addEventListener('gesturestart', gesture, { capture: true, passive: false })
  target.addEventListener('gesturechange', gesture, { capture: true, passive: false })
  return () => {
    target.removeEventListener('wheel', wheel, true)
    target.removeEventListener('gesturestart', gesture, true)
    target.removeEventListener('gesturechange', gesture, true)
  }
}

export function guardPreviewFrameZoom(frame: HTMLIFrameElement): void {
  // srcDoc is same-origin but deliberately disallows scripts. Install from the
  // trusted parent, keeping the sandbox and extension IPC boundary unchanged.
  try {
    const target = frame.contentWindow
    if (target && frame.contentDocument) guardPageZoom(target)
  } catch {
    // Never relax the sandbox or inspect a cross-origin document.
  }
}
