import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './global.css'

async function mount() {
  const pet = new URLSearchParams(location.search).has('desktop-pet')
  if (pet) document.documentElement.dataset.petWindow = ''
  else await (await import('../platform/user-data.ts')).recoverLocalRestore()
  // The pet must never mount App's task dispatcher or capability bridge.
  const Component = pet ? (await import('../features/desktop-pet/DesktopPet.tsx')).DesktopPet : (await import('./App.tsx')).App
  createRoot(document.getElementById('root')!).render(<StrictMode><Component /></StrictMode>)
}
void mount().catch((error) => { document.getElementById('root')!.textContent = `无法打开窗口 / Could not open window: ${String(error)}` })
