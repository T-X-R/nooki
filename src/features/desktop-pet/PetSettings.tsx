import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useTranslation } from 'react-i18next'
import './desktop-pet.css'

export function PetSettings() {
  const { t } = useTranslation()
  const [enabled, setEnabled] = useState(false)
  const [busy, setBusy] = useState(true)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let current = true
    void invoke<{ enabled: boolean }>('desktop_pet_preferences').then(p => {
      if (current) { setEnabled(p.enabled); setReady(true) }
    }).catch(reason => { if (current) setError(String(reason)) }).finally(() => { if (current) setBusy(false) })
    return () => { current = false }
  }, [])
  async function toggle() {
    setBusy(true); setError('')
    try {
      const p = await invoke<{ enabled: boolean }>('desktop_pet_set_enabled', { enabled: !enabled })
      setEnabled(p.enabled)
    } catch (reason) { setError(String(reason)) }
    finally { setBusy(false) }
  }
  return <div className="pet-setting">
    <button id="desktop-pet-switch" type="button" className="pet-switch" role="switch" aria-checked={enabled} disabled={busy || !ready} onClick={() => void toggle()}>
      <span className="pet-switch-track" aria-hidden="true" />
      {t('showDesktopPet')}
    </button>
    {error && <p role="alert" className="pet-error">{error}</p>}
  </div>
}
