import { ArchiveIcon } from '@radix-ui/react-icons'

export function LibraryNavigation({ language, active, onEnter }: { language: 'zh' | 'en'; active: boolean; onEnter(): void }) {
  return <button className={`nav-item ${active ? 'is-active' : ''}`} aria-current={active ? 'page' : undefined} onClick={onEnter}><span className="nav-item-main"><ArchiveIcon />{language === 'zh' ? '资料库' : 'Library'}</span></button>
}
