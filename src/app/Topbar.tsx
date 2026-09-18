import { useTranslation } from 'react-i18next'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { MagnifyingGlassIcon } from '@radix-ui/react-icons'

export function Topbar({ onOpenCommand }: { onOpenCommand: () => void }) {
  const { t } = useTranslation()
  return (
    <header
      className="topbar"
      data-tauri-drag-region
      onDoubleClick={(event) => {
        if (!window.__TAURI_INTERNALS__ || (event.target as HTMLElement).closest('button')) return
        void getCurrentWindow().toggleMaximize()
      }}
    >
      <div className="topbar-actions">
        <button className="topbar-search" aria-label={`${t('searchWorkbench')} (⌘ K)`} onClick={onOpenCommand}><MagnifyingGlassIcon /><kbd>⌘ K</kbd></button>
      </div>
    </header>
  )
}
