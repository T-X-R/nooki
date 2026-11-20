const { label, httpPort, udpPort } = window.PROBE
const invoke = (name, args = {}) => window.__TAURI_INTERNALS__.invoke(name, args)
const display = value => { document.getElementById('result').textContent = JSON.stringify(value, null, 2) }
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const outcome = async operation => { try { return { fulfilled: true, value: await operation() } } catch (e) { return { fulfilled: false, error: String(e) } } }
const attemptRTC = () => outcome(async () => {
  const peer = new RTCPeerConnection({ iceServers: [{ urls: `stun:127.0.0.1:${udpPort}` }] })
  setTimeout(() => peer.close(), 3000)
  peer.createDataChannel('synthetic')
  await peer.setLocalDescription(await peer.createOffer())
  return 'ICE gathering started; inspect native UDP receiver, not this return value'
})
// Exercise the first script execution as well as the later user-triggered probe.
void attemptRTC().then(rtc => invoke('probe_report', { value: { packageScriptStarted: true, rtc } }))
document.getElementById('title').textContent = label
if (label === 'probe-shell') localStorage.setItem('host-secret', 'synthetic-host-storage')
setInterval(() => void invoke('probe_tick'), 250)

window.runProbe = async () => {
  const results = { userAgent: navigator.userAgent, parentIsSelf: parent === window, openerAbsent: opener === null, hostStorage: localStorage.getItem('host-secret'), initialMarker: localStorage.getItem('marker') }
  results.networkFeatures = { webTransport: typeof window.WebTransport, webSocketStream: typeof window.WebSocketStream, prefixedPeerConnection: typeof window.webkitRTCPeerConnection }
  localStorage.setItem('marker', label)
  results.spoofedCaller = await outcome(() => invoke('probe_rpc', { owner: label === 'probe-shell' ? 'probe-a' : 'probe-shell', payload: '' }))
  results.protectedHostCommand = await outcome(() => invoke('probe_host_secret'))
  results.unguardedAppCommand = await outcome(() => invoke('probe_unguarded'))
  results.unknownAppCommand = await outcome(() => invoke('future_command'))
  results.hostControlCommand = label === 'probe-shell' ? 'shell control' : await outcome(() => invoke('probe_control', { action: 'status' }))
  results.coreWindowCommand = await outcome(() => invoke('plugin:window|set_title', { label: 'probe-shell', title: 'Changed by a package' }))
  results.oversizedMessage = await outcome(() => invoke('probe_rpc', { owner: label, payload: 'x'.repeat(65537) }))
  const timings = []
  for (const size of [0, 1024, 65536]) {
    const start = performance.now()
    const echoed = await invoke('probe_rpc', { owner: label, payload: 'x'.repeat(size) })
    timings.push({ bytes: size, elapsedMs: performance.now() - start, exact: echoed === 'x'.repeat(size) })
  }
  results.ipc = timings
  results.crossPackageAsset = await outcome(async () => (await fetch('nookiprobe://localhost/private/probe-other')).status)
  const base = `http://127.0.0.1:${httpPort}`
  results.fetch = await outcome(() => fetch(`${base}/fetch`, { mode: 'no-cors' }).then(() => 'sent'))
  results.beacon = await outcome(() => navigator.sendBeacon(`${base}/beacon`, 'synthetic'))
  results.websocket = await outcome(() => { const socket = new WebSocket(`ws://127.0.0.1:${httpPort}/socket`); setTimeout(() => socket.close(), 1000); return 'created' })
  const image = new Image(); image.src = `${base}/image`; document.body.append(image)
  results.popupAbsent = window.open(`${base}/popup`, 'probe-shell') === null
  results.rtc = await attemptRTC()
  const asset = new Image()
  results.asset = await outcome(() => new Promise((resolve, reject) => {
    asset.onload = () => resolve({ width: asset.naturalWidth, height: asset.naturalHeight })
    asset.onerror = () => reject('image load failed')
    asset.src = 'nookiprobe://localhost/pixel.svg'
  }))
  document.body.append(asset)
  const audio = new Audio('nookiprobe://localhost/tone.wav')
  results.media = await outcome(() => Promise.race([
    new Promise((resolve, reject) => {
      audio.onloadedmetadata = () => resolve({ duration: audio.duration })
      audio.onerror = () => reject('WAV metadata failed')
      audio.load()
    }), wait(3000).then(() => { throw new Error('WAV metadata timeout') }),
  ]))
  await wait(3500)
  audio.removeAttribute('src'); audio.load()
  results.markerAfterPeerWrites = localStorage.getItem('marker')
  display(results)
  await invoke('probe_report', { value: results })
}

window.startBusy = async () => {
  await invoke('probe_report', { value: { infiniteLoopStarted: true } })
  document.getElementById('result').textContent = 'Infinite loop starting; use the shell Destroy A control.'
  setTimeout(() => { while (true) { /* Deliberately hostile fixture, never shipped in Nooki. */ } }, 100)
}

for (const [id, action] of [['run', 'run'], ['extended', 'extended'], ['busy', 'busy'], ['stop', 'stop'], ['status', 'status']]) {
  const button = document.getElementById(id)
  button.disabled = label !== 'probe-shell'
  button.onclick = async () => display(await outcome(() => invoke('probe_control', { action })))
}
