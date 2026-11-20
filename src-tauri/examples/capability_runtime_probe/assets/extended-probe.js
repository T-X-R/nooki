const channelFetch = 'plugin:__TAURI_CHANNEL__|fetch'
window.tryForeignChannel = async id => {
  const result = await outcome(() => window.__TAURI_INTERNALS__.invoke(channelFetch, null, { headers: { 'Tauri-Channel-Id': String(id) } }).then(value => ({ bytes: value.length })))
  await invoke('probe_report', { value: { foreignChannel: result, dataId: id } })
}
const channelButton = document.getElementById('channel')
channelButton.disabled = label !== 'probe-shell'
channelButton.onclick = async () => {
  channelButton.disabled = true
  try {
    let callbackId
    const delivered = new Promise(resolve => {
      callbackId = window.__TAURI_INTERNALS__.transformCallback(event => { if (event.message !== undefined) resolve(event.message) })
    })
    const seeded = invoke('probe_control', { action: 'channel-seed', channel: `__CHANNEL__:${callbackId}` })
    // Deliberately bounded stall, synthetic shell only. Peer event loops and native dispatch keep running.
    const until = performance.now() + 2500
    while (performance.now() < until) { /* Keep the known message pending while peers attempt ID 0. */ }
    await seeded
    const value = await Promise.race([delivered, wait(3000).then(() => { throw new Error('owned channel delivery timeout') })])
    const result = { ownedChannel: { dataId: 0, exact: value === `synthetic-channel-sentinel:${'x'.repeat(9000)}`, bytes: value.length } }
    await invoke('probe_report', { value: result }); display(result)
  } catch (error) {
    await invoke('probe_report', { value: { channelProbeError: String(error) } })
  }
}

// Local synthetic channels only. Receiver evidence, not API return values, decides egress.
window.runExtendedProbe = async () => {
  const base = `http://127.0.0.1:${httpPort}`
  const results = { extendedNetwork: true }
  const nodes = []
  const append = node => { document.body.append(node); nodes.push(node); return node }
  const frame = append(Object.assign(document.createElement('iframe'), { name: 'network-target', src: `${base}/frame` }))
  await wait(300) // Do not let the later form immediately cancel the frame's control request.
  const form = append(Object.assign(document.createElement('form'), { method: 'POST', action: `${base}/form`, target: frame.name }))
  results.form = await outcome(() => { form.submit(); return 'submitted' })
  for (const [rel, path] of [['stylesheet', 'style'], ['preload', 'preload'], ['prefetch', 'prefetch']]) {
    append(Object.assign(document.createElement('link'), { rel, as: 'image', href: `${base}/${path}` }))
  }
  append(Object.assign(document.createElement('link'), { rel: 'preconnect', href: `http://127.0.0.1:${window.PROBE.preconnectPort}` }))
  // localhost never needs an external DNS query. This exercises the element only, not DNS packets.
  append(Object.assign(document.createElement('link'), { rel: 'dns-prefetch', href: '//localhost' }))
  results.dnsPrefetch = 'element exercised; native policy and separate DNS evidence required'
  const remoteAudio = new Audio(`${base}/media`); remoteAudio.load()
  let worker
  const workerURL = URL.createObjectURL(new Blob([`fetch(${JSON.stringify(`${base}/worker`)}, {mode:'no-cors'}).then(() => postMessage('worker fetch sent'), () => postMessage('worker fetch denied'));`], { type: 'text/javascript' }))
  results.worker = await outcome(() => new Promise((resolve, reject) => {
    worker = new Worker(workerURL)
    worker.onmessage = event => resolve(event.data)
    worker.onerror = () => reject('worker load blocked or failed')
    setTimeout(() => reject('worker response timeout'), 2000)
  }))
  results.serviceWorker = await outcome(async () => {
    const registration = await navigator.serviceWorker.register('nookiprobe://localhost/service-worker.js')
    await registration.unregister()
    return 'registered then unregistered'
  })
  await wait(2500)
  worker?.terminate(); URL.revokeObjectURL(workerURL); remoteAudio.removeAttribute('src'); remoteAudio.load()
  nodes.forEach(node => node.remove())
  display(results)
  await invoke('probe_report', { value: results })
  // Last: an unrestricted control leaves the fixture, while restricted views must stay usable.
  location.href = `${base}/navigation`
}

let testAudio
window.reportMediaState = async () => {
  if (!testAudio) return
  await invoke('probe_report', { value: { playback: { paused: testAudio.paused, ended: testAudio.ended, currentTime: testAudio.currentTime, readyState: testAudio.readyState, networkState: testAudio.networkState, focused: document.hasFocus() } } })
}
document.getElementById('play').onclick = async () => {
  if (testAudio) { testAudio.pause(); testAudio.removeAttribute('src'); testAudio.load() }
  testAudio = new Audio('nookiprobe://localhost/tone.wav')
  testAudio.loop = true
  const started = await outcome(() => testAudio.play()) // Called directly from the user gesture.
  await wait(350)
  await invoke('probe_report', { value: { playbackStart: started } })
  await window.reportMediaState()
  display({ playing: !testAudio.paused, currentTime: testAudio.currentTime })
}
document.getElementById('release').onclick = async () => {
  if (!testAudio) return
  testAudio.pause()
  const pausedAt = testAudio.currentTime
  await wait(200)
  const stoppedAdvancing = testAudio.currentTime === pausedAt
  testAudio.removeAttribute('src'); testAudio.load()
  await wait(100)
  const released = { mediaReleased: true, stoppedAdvancing, paused: testAudio.paused, readyState: testAudio.readyState, networkState: testAudio.networkState, srcAttribute: testAudio.getAttribute('src'), currentSrc: testAudio.currentSrc }
  await invoke('probe_report', { value: released })
  display(released)
  testAudio = undefined
}
