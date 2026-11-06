// Both desktop windows share the same local origin. A receipt belongs to one
// delivery so a late observation of an older turn cannot clear a newer reminder.
function receiptKey(taskId: string, turnId: string) {
  return `nooki:pet:seen-delivery:${JSON.stringify([taskId, turnId])}`
}

export function isDeliveryRead(taskId: string, turnId: string) {
  return localStorage.getItem(receiptKey(taskId, turnId)) === '1'
}

export function observeDelivery(taskId: string, turnId: string, turn: HTMLElement) {
  if (isDeliveryRead(taskId, turnId)) return
  const results = [...turn.querySelectorAll('.conversation-answer:not(.is-commentary) .conversation-markdown, .conversation-artifact')]
    .filter(result => result.textContent?.trim())
  if (!results.length) return

  const inForeground = () => document.visibilityState === 'visible' && document.hasFocus()
  const observer = new IntersectionObserver(entries => {
    if (inForeground() && entries.some(entry => entry.isIntersecting && entry.intersectionRatio > 0)) {
      localStorage.setItem(receiptKey(taskId, turnId), '1')
      observer.disconnect()
    }
  })
  function observeVisibleResults() {
    observer.disconnect()
    if (inForeground() && !isDeliveryRead(taskId, turnId)) results.forEach(result => observer.observe(result))
  }
  observeVisibleResults()
  window.addEventListener('focus', observeVisibleResults)
  document.addEventListener('visibilitychange', observeVisibleResults)
  return () => {
    observer.disconnect()
    window.removeEventListener('focus', observeVisibleResults)
    document.removeEventListener('visibilitychange', observeVisibleResults)
  }
}
