(() => {
  'use strict'
  const source = window.ClipsX?.context?.representation?.text ?? ''
  const sourceElement = document.querySelector('#source')
  const sourceDetails = document.querySelector('#source-details')
  const diagram = document.querySelector('#diagram')
  const close = document.querySelector('#close')
  const theme = window.ClipsX?.context?.theme === 'dark' ? 'dark' : 'light'
  document.documentElement.dataset.theme = theme
  sourceElement.textContent = source
  const isDialog = window.ClipsX?.context?.surface === 'dialog'
  close.hidden = !isDialog
  close.addEventListener('click', () => window.ClipsX.close())

  const themeVariables =
    theme === 'dark'
      ? {
          background: '#172033',
          primaryColor: '#252e46',
          primaryTextColor: '#e2e8f0',
          primaryBorderColor: '#8b5cf6',
          lineColor: '#a78bfa',
          secondaryColor: '#312e55',
          tertiaryColor: '#1e293b',
          textColor: '#e2e8f0',
          mainBkg: '#252e46',
          nodeBorder: '#8b5cf6',
          clusterBkg: '#1e293b',
          clusterBorder: '#64748b',
        }
      : {
          background: '#f8fafc',
          primaryColor: '#f5f3ff',
          primaryTextColor: '#1e293b',
          primaryBorderColor: '#7c3aed',
          lineColor: '#7c3aed',
          secondaryColor: '#ede9fe',
          tertiaryColor: '#f1f5f9',
          textColor: '#1e293b',
          mainBkg: '#f5f3ff',
          nodeBorder: '#7c3aed',
          clusterBkg: '#f8fafc',
          clusterBorder: '#94a3b8',
        }

  const render = async () => {
    try {
      if (!window.mermaid) throw new Error('The bundled Mermaid runtime did not load.')
      window.mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        htmlLabels: false,
        suppressErrorRendering: true,
        maxTextSize: 100000,
        theme: theme === 'dark' ? 'dark' : 'default',
        themeVariables,
      })
      const diagramId = `clipsx-mermaid-${Date.now()}-${Math.random().toString(36).slice(2)}`
      const { svg } = await window.mermaid.render(diagramId, source)
      // Mermaid strict mode sanitizes generated SVG and disables interactive
      // links. The host child-webview CSP also blocks navigation and networking.
      diagram.innerHTML = svg
      const rendered = diagram.querySelector('svg')
      rendered?.setAttribute('role', 'img')
      rendered?.setAttribute('aria-label', 'Rendered Mermaid diagram')
      window.ClipsX.ready()
    } catch (error) {
      const fallback = document.createElement('p')
      fallback.textContent =
        'The diagram could not be rendered safely. Its accessible source is available below.'
      diagram.replaceChildren(fallback)
      sourceDetails.open = true
      window.ClipsX.ready()
    }
  }

  void render()
})()
