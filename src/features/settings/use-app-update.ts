import { useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'

type UpdateCheck =
  | { status: 'unavailable' | 'upToDate' }
  | { status: 'available'; version: string; notes: string | null }

export function useAppUpdate(onAvailable: (version: string) => void) {
  const started = useRef(false)
  const [result, setResult] = useState<UpdateCheck>()
  const [checking, setChecking] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [message, setMessage] = useState('')

  const check = async (automatic = false) => {
    if (!window.__TAURI_INTERNALS__ || checking || installing) return
    setChecking(true)
    setMessage('')
    try {
      const next = await invoke<UpdateCheck>('app_update_check')
      setResult(next)
      if (automatic && next.status === 'available') onAvailable(next.version)
    } catch {
      if (!automatic) setMessage('updateCheckFailed')
    } finally {
      setChecking(false)
    }
  }

  useEffect(() => {
    if (started.current) return
    started.current = true
    void check(true)
  }, [])

  const install = async () => {
    if (result?.status !== 'available' || checking || installing) return
    setInstalling(true)
    setMessage('')
    try {
      const outcome = await invoke<'busy' | 'checkAgain'>('app_update_install', { version: result.version })
      if (outcome === 'checkAgain') setResult(undefined)
      setMessage(outcome === 'busy' ? 'updateTasksBusy' : 'updateCheckAgain')
    } catch {
      setMessage('updateInstallFailed')
    } finally {
      setInstalling(false)
    }
  }

  return { result, checking, installing, message, check, install }
}
