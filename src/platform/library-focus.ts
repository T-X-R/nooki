// Capture before native issuance can let React disable the keyboard trigger.
export function captureLibraryFocus() {
  const previous = document.activeElement
  return () => {
    if (!(previous instanceof HTMLElement) || previous === document.body) return
    let cancelled = false
    const events = ['focusin', 'pointerdown', 'keydown'] as const
    const stop = () => {
      cancelled = true
      observer.disconnect()
      for (const event of events) document.removeEventListener(event, stop, true)
    }
    const restore = () => {
      if (cancelled) return
      // A new interaction/modal or removed trigger supersedes this request.
      if (!previous.isConnected || (document.activeElement !== document.body && document.activeElement !== previous)
        || document.querySelector('dialog[open]')) { stop(); return }
      if (!previous.matches(':disabled')) { stop(); previous.focus({ preventScroll: true }) }
    }
    const observer = new MutationObserver(restore)
    // React may re-enable the caller after the first animation frame. Observe that
    // actual transition instead of guessing a delay; removal or new input cancels it.
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['disabled'] })
    for (const event of events) document.addEventListener(event, stop, true)
    requestAnimationFrame(restore)
  }
}
