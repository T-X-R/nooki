import { getCurrentWindow } from '@tauri-apps/api/window'
import type { MouseEvent } from 'react'

export function startWindowDrag(event: MouseEvent<HTMLElement>) {
  if (!window.__TAURI_INTERNALS__ || event.button !== 0 || (event.target as HTMLElement).closest('button, a, input, textarea, select, [contenteditable], [role=button]')) return
  event.preventDefault()
  const windowHandle = getCurrentWindow()
  if (event.detail === 2) void windowHandle.toggleMaximize()
  else void windowHandle.startDragging()
}
