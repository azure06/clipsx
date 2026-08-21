(() => {
  'use strict'
  const selected = window.ClipsX.context.representation.text ?? ''
  const source = document.querySelector('#source')
  const response = document.querySelector('#response')
  const status = document.querySelector('#status')
  const send = document.querySelector('#send')
  const copy = document.querySelector('#copy')
  const save = document.querySelector('#save')
  source.textContent = selected
  let result = ''

  send.addEventListener('click', async () => {
    send.disabled = true
    status.textContent = 'Sending through the ClipsX HTTPS broker…'
    try {
      const body = new TextEncoder().encode(JSON.stringify({ text: selected }))
      const reply = await window.ClipsX.https({
        url: 'https://httpbin.org/anything',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: Array.from(body),
      })
      result = new TextDecoder().decode(new Uint8Array(reply.body))
      response.textContent = result
      status.textContent = `Completed with HTTP ${reply.status}.`
      copy.disabled = false
      save.disabled = false
    } catch (error) {
      status.textContent = String(error)
    } finally {
      send.disabled = false
    }
  })
  copy.addEventListener('click', () => window.ClipsX.submitText('application/json', result, 'copy'))
  save.addEventListener('click', () => window.ClipsX.submitText('application/json', result, 'save_as_clip'))
  document.querySelector('#close').addEventListener('click', () => window.ClipsX.close())
})()
