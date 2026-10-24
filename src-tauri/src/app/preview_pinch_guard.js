// A Windows precision-trackpad pinch arrives as Ctrl+wheel. Cancel native page
// scaling in every frame without stopping the preview's own wheel listener.
globalThis.window.addEventListener(
  'wheel',
  event => {
    if (event.ctrlKey) event.preventDefault()
  },
  { capture: true, passive: false }
)
