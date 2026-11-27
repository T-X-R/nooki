// Two sequential 1 MiB synthetic requests per package, never an OOM/flood test.
window.runIngressProbe = async () => {
  const payload = 'x'.repeat(1024 * 1024)
  const start = performance.now()
  const deniedCommand = await outcome(() => invoke('probe_ingress', { payload }))
  const deniedAsset = await outcome(async () => {
    const response = await fetch('nookiprobe://localhost/budget-ingress', { method: 'POST', body: payload })
    return { status: response.status, text: await response.text() }
  })
  const result = { ingressProbe: true, sentBytesPerRequest: payload.length, deniedCommand, deniedAsset, elapsedMs: performance.now() - start }
  await invoke('probe_report', { value: result })
  display(result)
}
const ingressButton = document.getElementById('ingress')
ingressButton.disabled = label !== 'probe-shell'
ingressButton.onclick = async () => {
  ingressButton.disabled = true
  display(await outcome(() => invoke('probe_control', { action: 'ingress' })))
}
