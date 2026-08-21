(() => {
  'use strict'
  const source = window.ClipsX?.context?.representation?.text ?? ''
  const sourceElement = document.querySelector('#source')
  const diagram = document.querySelector('#diagram')
  const expand = document.querySelector('#expand')
  const close = document.querySelector('#close')
  sourceElement.textContent = source
  const isDialog = window.ClipsX?.context?.surface === 'dialog'
  expand.hidden = isDialog
  close.hidden = !isDialog
  expand.addEventListener('click', () => window.ClipsX.openDialog())
  close.addEventListener('click', () => window.ClipsX.close())

  window.mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    htmlLabels: false,
    suppressErrorRendering: true,
    maxTextSize: 100000,
  })

  window.mermaid
    .render(`clipsx-mermaid-${crypto.randomUUID()}`, source)
    .then(({ svg }) => {
      // Mermaid strict mode sanitizes generated SVG and disables interactive
      // links. The host child-webview CSP also blocks navigation and networking.
      diagram.innerHTML = svg
      const rendered = diagram.querySelector('svg')
      rendered?.setAttribute('role', 'img')
      rendered?.setAttribute('aria-label', 'Rendered Mermaid diagram')
    })
    .catch(() => {
      const fallback = document.createElement('p')
      fallback.textContent =
        'The diagram could not be rendered safely. Its accessible source is available below.'
      diagram.replaceChildren(fallback)
    })
})()
