import { motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArchiveIcon, BackpackIcon, CalendarIcon, ChatBubbleIcon, ChevronRightIcon, CubeIcon, EnterIcon, GearIcon, KeyboardIcon, LightningBoltIcon, MagnifyingGlassIcon, MoonIcon, SunIcon } from '@radix-ui/react-icons'
import i18n from '../shared/i18n.ts'
import type { Theme, View } from '../platform/preferences.ts'

export function CommandPalette({ onClose, onNavigate, onNotice, theme, onToggleTheme }: { onClose: () => void; onNavigate: (view: View) => void; onNotice: (message: string) => void; theme: Theme; onToggleTheme: () => void }) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => inputRef.current?.focus(), [])

  const commands = useMemo(() => [
    { label: t('openToday'), hint: t('navigation'), icon: CalendarIcon, action: () => onNavigate('today') },
    { label: i18n.language.startsWith('zh') ? '打开对话' : 'Open conversations', hint: t('navigation'), icon: ChatBubbleIcon, action: () => onNavigate('conversations') },
    { label: t('openLibrary'), hint: t('navigation'), icon: ArchiveIcon, action: () => onNavigate('library') },
    { label: i18n.language.startsWith('zh') ? '打开技能池' : 'Open skill pool', hint: t('navigation'), icon: BackpackIcon, action: () => onNavigate('skills') },
    { label: t('openCapabilities'), hint: t('navigation'), icon: CubeIcon, action: () => onNavigate('capabilities') },
    { label: t('openSettings'), hint: t('navigation'), icon: GearIcon, action: () => onNavigate('settings') },
    { label: theme === 'light' ? t('switchToDark') : t('switchToLight'), hint: t('appearanceHint'), icon: theme === 'light' ? MoonIcon : SunIcon, action: () => { onToggleTheme(); onClose() } },
    { label: t('viewPlatformStatus'), hint: t('system'), icon: LightningBoltIcon, action: () => { onNavigate('settings'); onNotice(t('providerLocated')) } },
  ].filter((command) => command.label.toLowerCase().includes(query.toLowerCase())), [onNavigate, onNotice, onToggleTheme, onClose, query, t, theme])

  useEffect(() => setHighlightedIndex(0), [query])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setHighlightedIndex((index) => commands.length ? (index + 1) % commands.length : 0)
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setHighlightedIndex((index) => commands.length ? (index - 1 + commands.length) % commands.length : 0)
      }
      if (event.key === 'Enter' && commands[highlightedIndex]) {
        event.preventDefault()
        commands[highlightedIndex].action()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [commands, highlightedIndex])

  return <div className="palette-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><motion.section className="command-palette" role="dialog" aria-modal="true" initial={{ opacity: 0, y: -10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8, scale: 0.99 }}><div className="palette-search"><MagnifyingGlassIcon /><input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('actionPlaceholder')} /><kbd>ESC</kbd></div><div className="palette-list">{commands.length > 0 ? commands.map((command, index) => { const Icon = command.icon; return <button key={command.label} className={`palette-item ${index === highlightedIndex ? 'is-highlighted' : ''}`} onMouseEnter={() => setHighlightedIndex(index)} onClick={command.action}><span className="palette-item-icon"><Icon /></span><span>{command.label}</span><small>{command.hint}</small><ChevronRightIcon /></button> }) : <div className="palette-no-results">{t('noMatchingActions')}</div>}</div><div className="palette-footer"><span><KeyboardIcon /> {t('arrowKeysToSelect')}</span><span><EnterIcon /> {t('enterToRun')}</span></div></motion.section></div>
}
