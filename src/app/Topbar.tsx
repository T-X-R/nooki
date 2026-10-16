import { useTranslation } from 'react-i18next'
import { startWindowDrag } from './window-drag.ts'
import { MagnifyingGlassIcon } from '@radix-ui/react-icons'

export function Topbar({ onOpenCommand }: { onOpenCommand: () => void }) {
  const { t } = useTranslation()
  return (
    <header
      className="topbar"
      onMouseDown={startWindowDrag}
    >
      <div className="topbar-actions">
        <button className="topbar-search" aria-label={`${t('searchWorkbench')} (⌘ K)`} onClick={onOpenCommand}><MagnifyingGlassIcon /><kbd>⌘ K</kbd></button>
      </div>
    </header>
  )
}
