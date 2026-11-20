// Bounded synthetic bursts: at most 24 requests/round across both callers.
window.runLoadProbe = async () => {
  const rounds = []
  for (const bytes of [1, 65536, 65537]) {
    const start = performance.now()
    const outcomes = await Promise.all(Array.from({ length: 12 }, async () => {
      const requestStart = performance.now()
      const result = await outcome(() => invoke('probe_load', { payload: 'x'.repeat(bytes) }))
      const elapsedMs = performance.now() - requestStart
      return result.fulfilled
        ? { accepted: true, exact: result.value.bytes === bytes && result.value.checksum === bytes * 120, elapsedMs }
        : { accepted: false, error: result.error, elapsedMs }
    }))
    rounds.push({ bytes, elapsedMs: performance.now() - start, outcomes })
    // Keep both callers' rounds separated even if one burst was wholly refused.
    await wait(2500)
  }
  const failure = await outcome(() => invoke('probe_load', { payload: 'synthetic-failure' }))
  const recovery = await outcome(() => invoke('probe_load', { payload: 'recovered' }))
  const result = { loadProbe: true, rounds, failure, recovery }
  await invoke('probe_report', { value: result })
  display(result)
}

const loadButton = document.getElementById('load')
loadButton.disabled = label !== 'probe-shell'
loadButton.onclick = async () => {
  loadButton.disabled = true
  display(await outcome(() => invoke('probe_control', { action: 'load' })))
}
