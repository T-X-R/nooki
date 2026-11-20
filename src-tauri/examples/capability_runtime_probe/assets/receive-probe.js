window.runReceiveProbe = async () => {
  const attempt = operation => outcome(() => Promise.race([operation(), wait(5000).then(() => { throw new Error('receive probe timeout') })]))
  const fetchResult = (url, init) => attempt(async () => {
    const response = await fetch(url, init)
    return { status: response.status, body: await response.text() }
  })
  const nativeHandler = typeof window.webkit?.messageHandlers?.ipc
  const identity = await invoke('probe_identity')
  const echo = await attempt(async () => (await invoke('probe_rpc', { owner: label, payload: 'x'.repeat(32768) })) === 'x'.repeat(32768))
  const spoof = await attempt(() => invoke('probe_rpc', { owner: 'probe-shell', payload: '' }))
  const coreWindow = await attempt(() => invoke('plugin:window|set_title', { label: window.PROBE.hostWindow, value: 'Changed by a package' }))
  const hostCommand = await attempt(() => invoke('probe_host_secret'))
  const oversized = await attempt(() => invoke('probe_ingress', { payload: 'x'.repeat(1048576) }))
  const assetPost = await fetchResult('nookiprobe://localhost/budget-ingress', { method: 'POST', body: 'x'.repeat(1048576) })
  const otherProtocol = await fetchResult('tauri://localhost/budget-ingress', { method: 'POST', body: 'x'.repeat(1048576) })
  const longUrl = await fetchResult(`nookiprobe://localhost/${'x'.repeat(2100)}`)
  const largeHeader = await fetchResult('nookiprobe://localhost/pixel.svg', { headers: { 'X-Probe': 'x'.repeat(4100) } })
  const malformed = await fetchResult('ipc://localhost/probe_rpc', { method: 'POST', body: '{', headers: { 'Content-Type': 'application/json' } })
  const abandoned = await fetchResult('ipc://localhost/probe_identity', { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json', 'Tauri-Callback': '0', 'Tauri-Error': '1', 'Tauri-Invoke-Key': 'invalid-probe-key' } })
  const asset = await fetchResult('nookiprobe://localhost/pixel.svg')
  const controller = new AbortController()
  const pending = fetchResult('nookiprobe://localhost/receive-delay', { signal: controller.signal })
  await wait(50)
  controller.abort()
  const cancelled = await pending
  await wait(2300)
  await wait(1100)
  const burst = await Promise.all(Array.from({ length: 32 }, () => fetchResult('nookiprobe://localhost/pixel.svg')))
  await wait(1100)
  const load = await Promise.all(Array.from({ length: 6 }, () => attempt(() => invoke('probe_load', { payload: 'synthetic' }))))
  // A caller whose work was refused must also wait for the peer's admitted work.
  await wait(2500)
  const recovery = await attempt(() => invoke('probe_rpc', { owner: label, payload: 'recovered' }))
  const result = { receiveProbe: true, nativeHandler, identity, echo, spoof, coreWindow, hostCommand, oversized, assetPost, otherProtocol, longUrl, largeHeader, malformed, abandoned, asset, cancelled, burst, load, recovery }
  await invoke('probe_report', { value: result })
  display(result)
}
const receiveButton = document.getElementById('receive')
receiveButton.disabled = label !== 'probe-shell'
receiveButton.onclick = async () => {
  receiveButton.disabled = true
  display(await outcome(() => invoke('probe_control', { action: 'receive' })))
}
