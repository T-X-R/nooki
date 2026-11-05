import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

// Listen before checking the mailbox: a pet click can arrive while main is loading.
export function connectPetNavigation(open: (id: string) => void) {
  let disposed = false
  let unlisten: (() => void) | undefined
  let pending = Promise.resolve()
  const receive = () => {
    pending = pending.then(async () => {
      const id = await invoke<string | null>('desktop_pet_navigation')
      if (!disposed && id) {
        open(id)
        await invoke('desktop_pet_navigation_ack', { id })
      }
    }).catch(error => console.error('Pet conversation navigation failed', error))
  }
  void listen('desktop-pet:navigate', receive).then(off => {
    if (disposed) off()
    else { unlisten = off; receive() }
  }).catch(error => console.error('Pet navigation subscription failed', error))
  return () => { disposed = true; unlisten?.() }
}
