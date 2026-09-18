import { useTranslation } from 'react-i18next'
import { BackpackIcon, CalendarIcon, ClockIcon, CubeIcon, GearIcon, MoonIcon, SunIcon } from '@radix-ui/react-icons'
import type { InstalledCapability } from '../platform/capability-host.ts'
import type { Organization } from '../platform/library-store.ts'
import { LibraryNavigation } from '../features/library/LibraryNavigation.tsx'
import { ConversationNavigation } from '../features/conversation/ConversationNavigation.tsx'
import { LEGACY_REVIEW } from '../features/conversation/conversation-model.ts'
import { CapabilityIcon, capabilityCopy } from '../features/capabilities/capability-presentation.tsx'
import { useWorkbench, type View } from '../platform/preferences.ts'
import nookiIcon from '../assets/nooki-icon.png'

export function Sidebar({ organization, organizationError, libraryTopicId, onSelectTopic, activeConversationId, onOpenConversation, activeView, activeCapabilityId, installed, onNavigate, onOpenCapability }: { organization: Organization; organizationError: string; libraryTopicId: string; onSelectTopic(id: string): void; activeConversationId: string | null; onOpenConversation(id: string | null): void; activeView: View; activeCapabilityId: string | null; installed: InstalledCapability[]; onNavigate: (view: View) => void; onOpenCapability: (id: string) => void }) {
  const { t } = useTranslation()
  const { theme, setTheme, language } = useWorkbench()
  const enabledCapabilities = installed.filter((capability) => capability.enabled && capability.manifest.id !== LEGACY_REVIEW)

  return (
    <aside className="sidebar">
      <div className="brand-lockup">
        <img className="brand-mark" src={nookiIcon} alt="" aria-hidden="true" />
        <span className="brand-name" role="img" aria-label="Nooki">
          <svg viewBox="0 0 132 44" fill="none" aria-hidden="true">
            <g stroke="currentColor" strokeWidth="6.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 34 10 10Q10 8 12 11L27 33Q29 36 29 32L32 9" />
              <path d="M53 20C42 15 35 29 42 34C50 40 61 23 53 20Z" />
              <path d="M78 19C66 14 60 30 67 35C76 40 87 23 78 19Z" />
              <path d="m94 9-3 26m3-8 14-10m-12 9 11 10m14-16-2 15" />
            </g>
            <path d="M123 5c3 0 4 3 2 5s-6 2-6-1 2-4 4-4Z" fill="currentColor" />
          </svg>
        </span>
      </div>

      <div className="sidebar-label">{t('workspace')}</div>
      <nav className="primary-nav" aria-label={t('mainNavigation')}>
        <button className={`nav-item ${activeView === 'today' ? 'is-active' : ''}`} aria-current={activeView === 'today' ? 'page' : undefined} onClick={() => onNavigate('today')}>
          <span className="nav-item-main"><CalendarIcon />{t('today')}</span>
          <span className="nav-hint">01</span>
        </button>
        <LibraryNavigation language={language} active={activeView === 'library'} topicId={libraryTopicId} organization={organization} error={organizationError} onEnter={() => onNavigate('library')} onSelect={onSelectTopic} />
        <button className={`nav-item ${activeView === 'skills' ? 'is-active' : ''}`} aria-current={activeView === 'skills' ? 'page' : undefined} onClick={() => onNavigate('skills')}>
          <span className="nav-item-main"><BackpackIcon />{language === 'zh' ? '技能池' : 'Skill pool'}</span>
        </button>
        <ConversationNavigation language={language} active={activeView === 'conversations'} selectedId={activeConversationId} onEnter={() => onNavigate('conversations')} onSelect={onOpenConversation} />
        <button className={`nav-item ${activeView === 'tasks' ? 'is-active' : ''}`} aria-current={activeView === 'tasks' ? 'page' : undefined} onClick={() => onNavigate('tasks')}>
          <span className="nav-item-main"><ClockIcon />{language === 'zh' ? '任务' : 'Tasks'}</span>
        </button>
        {enabledCapabilities.map((capability) => {
          const active = activeView === 'capability' && activeCapabilityId === capability.manifest.id
          return (
            <button key={capability.manifest.id} className={`nav-item ${active ? 'is-active' : ''}`} aria-current={active ? 'page' : undefined} onClick={() => onOpenCapability(capability.manifest.id)}>
              <span className="nav-item-main"><CapabilityIcon name={capability.manifest.icon} />{capabilityCopy(capability, language).name}</span>
            </button>
          )
        })}
        <button className={`nav-item ${activeView === 'capabilities' ? 'is-active' : ''}`} aria-current={activeView === 'capabilities' ? 'page' : undefined} onClick={() => onNavigate('capabilities')}>
          <span className="nav-item-main"><CubeIcon />{t('capabilities')}</span>
          <span className="nav-hint">—</span>
        </button>
      </nav>

      <div className="sidebar-spacer" />

      <button className={`nav-item sidebar-settings ${activeView === 'settings' ? 'is-active' : ''}`} onClick={() => onNavigate('settings')}>
        <span className="nav-item-main"><GearIcon />{t('settings')}</span>
        <span className="nav-hint">⌘,</span>
      </button>

      <div className="sidebar-footer">
        <button className="icon-button" aria-label={theme === 'light' ? t('switchDark') : t('switchLight')} onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
          {theme === 'light' ? <MoonIcon /> : <SunIcon />}
        </button>
        <span className="version-label">v0.3.0 · {t('localVersion')}</span>
      </div>
    </aside>
  )
}
