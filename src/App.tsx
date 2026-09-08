import { AnimatePresence, motion } from 'motion/react'
import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { getCurrentWindow } from '@tauri-apps/api/window'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  ArchiveIcon,
  ChatBubbleIcon,
  ArrowRightIcon,
  CalendarIcon,
  CheckCircledIcon,
  CheckIcon,
  ChevronRightIcon,
  ClockIcon,
  CodeIcon,
  KeyboardIcon,
  Cross2Icon,
  EnterIcon,
  ExclamationTriangleIcon,
  FileTextIcon,
  GearIcon,
  GlobeIcon,
  LightningBoltIcon,
  LockClosedIcon,
  MagnifyingGlassIcon,
  MagicWandIcon,
  MoonIcon,
  Pencil2Icon,
  PlusIcon,
  ReloadIcon,
  RocketIcon,
  CubeIcon,
  SunIcon,
  UpdateIcon,
} from '@radix-ui/react-icons'
import { checkProviderHealth, getProviderStatus, getSelectedProvider, setSelectedProvider, testSelectedProvider, type ProviderKind, type ProviderStatus } from './platform'
import { createCapabilityHost, type InstalledCapability } from './capability-host'
import { getCapabilityModule, getInstalledCapabilityPackagesWithState, installCapabilityPackage, listAvailableCapabilities, setCapabilityPackageEnabled, uninstallCapabilityPackage, rollbackCapabilityPackage, getCapabilityLoadError } from './capability-runtime'
import type { DocumentReference, SelectedDocument } from '../packages/capability-contract/src'
import { parseReferenceHref } from '../packages/capability-contract/src/references'
import { grantSelectedDocuments, readSourceReference } from './document-grants'
import { TodayActivity } from './TodayActivity'
import { searchLibraryContent, listLibraryDocuments, readLibraryDocument, type LibraryDocument, type LibraryDocumentMetadata } from './document-library'
import { buildLibraryTree, filterLibraryTree } from './library-tree'
import i18n, { type Language } from './i18n'
import { TaskPage } from './TaskPage'
import { PackageImportModal } from './PackageImportModal'
import { taskRunner } from './tasks'
import { ConversationPage } from './ConversationPage'
import { ConversationNavigation } from './ConversationNavigation'
import { CONVERSATION_OWNER, LEGACY_REVIEW } from './conversation-model'
import workbenchIcon from './assets/workbench-icon.png'

type View = 'today' | 'library' | 'capabilities' | 'settings' | 'capability' | 'tasks' | 'conversations'
type Theme = 'light' | 'dark'
type CapabilityFilter = 'all' | 'enabled' | 'disabled'

type WorkbenchState = {
  view: View
  theme: Theme
  language: Language
  providerKind: ProviderKind
  setView: (view: View) => void
  setTheme: (theme: Theme) => void
  setLanguage: (language: Language) => void
  setProviderKind: (providerKind: ProviderKind) => void
}

const useWorkbench = create<WorkbenchState>()(
  persist(
    (set) => ({
      view: 'today',
      theme: 'light',
      language: 'zh',
      providerKind: 'codex-api',
      setView: (view) => set({ view }),
      setTheme: (theme) => set({ theme }),
      setLanguage: (language) => set({ language }),
      setProviderKind: (providerKind) => set({ providerKind }),
    }),
    {
      name: 'personal-workbench-preferences',
      version: 3,
      migrate: (persistedState) => {
        const state = persistedState as Partial<WorkbenchState>
        const previousKind = state.providerKind as string | undefined
        const providerKind: ProviderKind = previousKind === 'codex-cli'
          ? 'codex-subscription'
          : previousKind === 'openai-api'
            ? 'codex-api'
            : previousKind === 'codex-subscription' || previousKind === 'compatible-api'
              ? previousKind
              : 'codex-api'
        const language: Language = state.language === 'en' ? 'en' : 'zh'
        return { ...state, providerKind, language }
      },
    },
  ),
)

function capabilityCopy(capability: { manifest: import('./capability-host').CapabilityManifest }, language: Language) {
  const translation = capability.manifest.locales?.[language]
  return {
    name: translation?.name || capability.manifest.name,
    description: translation?.description ?? capability.manifest.description,
  }
}

function CapabilityIcon({ name }: { name?: string }) {
  if (name === 'pencil-2') return <Pencil2Icon />
  if (name === 'magic-wand') return <MagicWandIcon />
  return <FileTextIcon />
}

function providerLabel(t: TFunction, kind: ProviderKind) {
  return kind === 'codex-api' ? t('providerApi') : kind === 'codex-subscription' ? t('providerSubscription') : t('providerCompatible')
}

function providerStateLabel(t: TFunction, state: ProviderStatus['state'] | undefined) {
  return state === 'ready' ? t('connected') : state === 'configured' ? t('configured') : state === 'error' ? t('needsAttention') : t('checking')
}

function App() {
  const { t } = useTranslation()
  const { view, theme, language, setView, setTheme, providerKind, setProviderKind } = useWorkbench()
  const [conversationTarget, setConversationTarget] = useState<string | null>(null)
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
  const [conversationDocuments, setConversationDocuments] = useState<string[]>([])
  const [documentTarget, setDocumentTarget] = useState<DocumentReference | null>(null)
  const [taskTarget, setTaskTarget] = useState<string | null>(null)
  const [commandOpen, setCommandOpen] = useState(false)
  const [providerStatus, setProviderStatus] = useState<ProviderStatus | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [installedCapabilities, setInstalledCapabilities] = useState<InstalledCapability[]>([])
  const [activeCapabilityId, setActiveCapabilityId] = useState<string | null>(null)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    if (window.__TAURI_INTERNALS__) {
      void getCurrentWindow().setTheme(theme)
    }
  }, [theme])

  useEffect(() => {
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en'
    void i18n.changeLanguage(language)
  }, [language])

  useEffect(() => {
    getSelectedProvider().then(setProviderKind)
  }, [setProviderKind])

  const refreshCapabilities = async () => {
    try {
      setInstalledCapabilities(await getInstalledCapabilityPackagesWithState())
      await taskRunner.initialize()
    } catch {
      showNotice(t('capabilitiesLoadFailed'))
    }
  }

  useEffect(() => {
    void refreshCapabilities()
  }, [])

  useEffect(() => {
    if (view === 'capability' && (!activeCapabilityId || !getCapabilityModule(activeCapabilityId))) {
      setView('capabilities')
    }
  }, [activeCapabilityId, setView, view])

  useEffect(() => {
    setProviderStatus(null)
    getProviderStatus(providerKind, language).then(setProviderStatus)
  }, [language, providerKind])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setCommandOpen((open) => !open)
      }
      if ((event.metaKey || event.ctrlKey) && event.key === ',') {
        event.preventDefault()
        setView('settings')
      }
      if (event.key === 'Escape') setCommandOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [setView])

  const showNotice = (message: string) => {
    setNotice(message)
    window.setTimeout(() => setNotice(null), 3200)
  }

  const navigate = (nextView: View) => {
    setView(nextView)
    setCommandOpen(false)
  }

  const openCapability = (id: string) => {
    if (id === LEGACY_REVIEW || id === CONVERSATION_OWNER) { navigate('conversations'); return }
    setActiveCapabilityId(id)
    navigate('capability')
  }

  const openDocument = (reference: DocumentReference) => {
    setDocumentTarget(reference)
    navigate('library')
  }
  useEffect(() => {
    const open = (event: Event) => openDocument((event as CustomEvent<DocumentReference>).detail)
    window.addEventListener('workbench:open-document', open)
    return () => window.removeEventListener('workbench:open-document', open)
  }, [])

  const selectProvider = async (kind: ProviderKind) => {
    try {
      await setSelectedProvider(kind)
      setProviderKind(kind)
    } catch {
      showNotice(t('providerSaveFailed'))
    }
  }

  return (
    <div className="app-shell">
      <WindowTitlebar />
      <div className="app-workspace">
        <Sidebar activeConversationId={activeConversationId} onOpenConversation={(id) => { setConversationTarget(id ?? 'new'); navigate('conversations') }} activeView={view} activeCapabilityId={activeCapabilityId} installed={installedCapabilities.filter((cap) => cap.manifest.id !== LEGACY_REVIEW)} onNavigate={navigate} onOpenCapability={openCapability} />
        <main className="app-main">
          <Topbar onOpenCommand={() => setCommandOpen(true)} />
          <AnimatePresence mode="wait">
            <motion.div
              key={view}
              className="page-wrap"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
            >
              {view === 'today' && <TodayPage installed={installedCapabilities.filter((cap) => cap.manifest.id !== LEGACY_REVIEW)} onNavigate={navigate} onOpenCapability={openCapability} onDocument={openDocument} onTask={(id) => { setTaskTarget(id); navigate('tasks') }} providerStatus={providerStatus} />}
              {view === 'conversations' && <ConversationPage onSelected={setActiveConversationId} language={language} targetId={conversationTarget} onTargetConsumed={() => setConversationTarget(null)} incomingIds={conversationDocuments} onConsumed={() => setConversationDocuments([])} onDocument={openDocument} />}
              {view === 'tasks' && <TaskPage onOpenConversation={(id) => { setConversationTarget(id); navigate('conversations') }} language={language} installed={installedCapabilities} selectedId={taskTarget} onOpenCapability={openCapability} />}
              {view === 'library' && <LibraryPage onAddToConversation={(ids) => { setConversationDocuments(ids); navigate('conversations') }} installed={installedCapabilities} target={documentTarget} onOpenCapability={openCapability} onDocument={openDocument} />}
              {view === 'capabilities' && <CapabilitiesPage installed={installedCapabilities.filter((cap) => cap.manifest.id !== LEGACY_REVIEW)} onRefresh={refreshCapabilities} onOpenCapability={openCapability} onNotice={showNotice} />}
              {view === 'capability' && activeCapabilityId && getCapabilityModule(activeCapabilityId) && <CapabilityErrorBoundary key={`${activeCapabilityId}:${getCapabilityModule(activeCapabilityId)!.manifest.version}`} onBack={() => navigate('capabilities')} language={language}><CapabilityPage module={getCapabilityModule(activeCapabilityId)!} /></CapabilityErrorBoundary>}
              {view === 'settings' && <SettingsPage onNotice={showNotice} providerStatus={providerStatus} onSelectProvider={selectProvider} onCheckProvider={async () => { const nextStatus = await checkProviderHealth(providerKind, language); setProviderStatus(nextStatus); return nextStatus }} />}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
      <AnimatePresence>
        {notice && (
          <motion.div
            className="toast"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
          >
            <CheckCircledIcon />
            {notice}
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {commandOpen && (
          <CommandPalette
            onClose={() => setCommandOpen(false)}
            onNavigate={navigate}
            onNotice={showNotice}
            theme={theme}
            onToggleTheme={() => setTheme(theme === 'light' ? 'dark' : 'light')}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

function WindowTitlebar() {
  const { t } = useTranslation()
  if (!window.__TAURI_INTERNALS__) return null

  const appWindow = getCurrentWindow()

  return (
    <header
      className="window-titlebar"
      data-tauri-drag-region
      onDoubleClick={(event) => {
        if ((event.target as HTMLElement).closest('button')) return
        void appWindow.toggleMaximize()
      }}
    >
      <div className="window-controls" role="group" aria-label={t('windowControls')}>
        <button type="button" className="window-control window-control-close" aria-label={t('closeWindow')} onClick={() => void appWindow.close()} />
        <button type="button" className="window-control window-control-minimize" aria-label={t('minimizeWindow')} onClick={() => void appWindow.minimize()} />
        <button type="button" className="window-control window-control-maximize" aria-label={t('maximizeWindow')} onClick={() => void appWindow.toggleMaximize()} />
      </div>
    </header>
  )
}

function Sidebar({ activeConversationId, onOpenConversation, activeView, activeCapabilityId, installed, onNavigate, onOpenCapability }: { activeConversationId: string | null; onOpenConversation(id: string | null): void; activeView: View; activeCapabilityId: string | null; installed: InstalledCapability[]; onNavigate: (view: View) => void; onOpenCapability: (id: string) => void }) {
  const { t } = useTranslation()
  const { theme, setTheme, language } = useWorkbench()
  const enabledCapabilities = installed.filter((capability) => capability.enabled && capability.manifest.id !== LEGACY_REVIEW)

  return (
    <aside className="sidebar">
      <div className="brand-lockup">
        <img className="brand-mark" src={workbenchIcon} alt="" aria-hidden="true" />
        <div className="brand-name">Workbench</div>
      </div>

      <div className="sidebar-label">{t('workspace')}</div>
      <nav className="primary-nav" aria-label={t('mainNavigation')}>
        <button className={`nav-item ${activeView === 'today' ? 'is-active' : ''}`} aria-current={activeView === 'today' ? 'page' : undefined} onClick={() => onNavigate('today')}>
          <span className="nav-item-main"><CalendarIcon />{t('today')}</span>
          <span className="nav-hint">01</span>
        </button>
        <button className={`nav-item ${activeView === 'library' ? 'is-active' : ''}`} aria-current={activeView === 'library' ? 'page' : undefined} onClick={() => onNavigate('library')}>
          <span className="nav-item-main"><ArchiveIcon />{t('library')}</span>
          <span className="nav-hint">02</span>
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

function Topbar({ onOpenCommand }: { onOpenCommand: () => void }) {
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

function TodayPage({ installed, onNavigate, onOpenCapability, onDocument, onTask, providerStatus }: { installed: InstalledCapability[]; onNavigate: (view: View) => void; onOpenCapability: (id: string) => void; onDocument: (reference: DocumentReference) => void; onTask: (id: string) => void; providerStatus: ProviderStatus | null }) {
  const { t } = useTranslation()
  const { language, providerKind } = useWorkbench()
  const enabled = installed.filter((capability) => capability.enabled)
  const primaryCapability = enabled[0]
  const primaryCapabilityName = primaryCapability ? capabilityCopy(primaryCapability, language).name : null
  const today = new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date())
  return (
    <div className="content-column today-page">
      <div className="page-intro">
        <div>
          <div className="eyebrow">{today}</div>
          <h1>{t('todayHeadingFirst')}<br /><em>{t('todayHeadingSecond')}</em></h1>
        </div>
        <div className="intro-actions">
          {primaryCapability && primaryCapabilityName
            ? <button className="primary-button" onClick={() => onOpenCapability(primaryCapability.manifest.id)}>{t('openNamedCapability', { name: primaryCapabilityName })}<ArrowRightIcon /></button>
            : <button className="primary-button" onClick={() => onNavigate('capabilities')}><PlusIcon />{t('installFirstCapability')}</button>}
        </div>
      </div>

      <div className="today-grid">
        <section className="surface surface-empty">
          <div className="surface-heading">
            <div><span className="section-kicker">WORKSPACE</span><h2>{t('todayStart')}</h2></div>
            <span className="count-label">{enabled.length === 0 ? t('zeroCapabilities') : language === 'zh' ? `${enabled.length} 个能力` : `${enabled.length} capabilities`}</span>
          </div>
          {enabled.length === 0 ? <div className="empty-stage">
            <div className="empty-orbit" aria-hidden="true"><span /><span /><span /></div>
            <div className="empty-stage-copy"><strong>{t('noEnabledCapabilities')}</strong><span>{t('installedCapabilitiesAppear')}</span></div>
            <button className="text-button" onClick={() => onNavigate('capabilities')}>{t('browseCapabilities')}<ArrowRightIcon /></button>
          </div> : <div className="today-capability-list">{enabled.map((capability) => { const copy = capabilityCopy(capability, language); return <button key={capability.manifest.id} className="today-capability-link" onClick={() => onOpenCapability(capability.manifest.id)}><span><strong>{copy.name}</strong><small>{copy.description}</small></span><ArrowRightIcon /></button> })}</div>}
        </section>

        <section className="surface provider-surface">
          <div className="surface-heading">
            <div><span className="section-kicker">AI PROVIDER</span><h2>{t('unifiedAi')}</h2></div>
            <LightningBoltIcon className="heading-icon" />
          </div>
          <div className="provider-status-line">
            <div className="provider-status-symbol"><LightningBoltIcon /></div>
            <div><strong>{providerStatus?.label ?? providerLabel(t, providerKind)}</strong><span>{providerStatus?.detail ?? t('providerChecking')}</span></div>
            <span className={`pill pill-${providerStatus?.state ?? 'preview'}`}>{providerStateLabel(t, providerStatus?.state)}</span>
          </div>
          <p className="provider-copy">{t('providerCopy')}</p>
          <button className="surface-link" onClick={() => onNavigate('settings')}>{t('viewProviderSettings')}<ChevronRightIcon /></button>
        </section>
      </div>

      <TodayActivity language={language} installed={installed} onDocument={onDocument} onTask={onTask} onCapability={onOpenCapability} />
    </div>
  )
}

class CapabilityErrorBoundary extends Component<{ children: ReactNode; onBack(): void; language: Language }, { error: string | null }> {
  state = { error: null as string | null }
  static getDerivedStateFromError(error: Error) { return { error: error.message } }
  render() {
    return this.state.error ? <div className="content-column" role="alert"><h2>{this.props.language === 'zh' ? '能力页面加载失败' : 'Capability page failed'}</h2><p>{this.state.error}</p><button className="primary-button" onClick={this.props.onBack}>{this.props.language === 'zh' ? '管理能力或回退版本' : 'Manage capability or roll back'}</button></div> : this.props.children
  }
}

function CapabilityPage({ module }: { module: import('./capability-runtime').CapabilityModule }) {
  const Page = module.Page
  const host = useMemo(() => createCapabilityHost(module.manifest.id, module.manifest.permissions, module.manifest.name), [module.manifest.id, module.manifest.name, module.manifest.permissions])
  return <Page host={host} />
}

function LibraryMarkdown({ content, onDocument }: { content: string; onDocument: (reference: DocumentReference) => void }) {
  return <Markdown remarkPlugins={[remarkGfm]} components={{ a: ({ href, children }) => {
    const reference = parseReferenceHref(href ?? '')
    return reference ? <a href={href} onClick={(event) => { event.preventDefault(); onDocument(reference) }}>{children}</a> : <a href={href}>{children}</a>
  } }}>{content}</Markdown>
}

function LibraryPage({ installed, target, onAddToConversation, onOpenCapability, onDocument }: { installed: InstalledCapability[]; target: DocumentReference | null; onAddToConversation(ids: string[]): void; onOpenCapability: (id: string) => void; onDocument: (reference: DocumentReference) => void }) {
  const { t } = useTranslation()
  const { language } = useWorkbench()
  const [documents, setDocuments] = useState<LibraryDocumentMetadata[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedDocument, setSelectedDocument] = useState<LibraryDocument | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [documentError, setDocumentError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [contentMatches, setContentMatches] = useState<Set<string>>(new Set())
  const [searchError, setSearchError] = useState<string | null>(null)
  const [selectedInputs, setSelectedInputs] = useState<Set<string>>(new Set())
  const [grantOpen, setGrantOpen] = useState(false)
  const [recipient, setRecipient] = useState('')
  const [grantBusy, setGrantBusy] = useState(false)
  const [grantError, setGrantError] = useState<string | null>(null)
  const [thisWeek, setThisWeek] = useState(false)
  const [sourceTarget, setSourceTarget] = useState<DocumentReference | null>(null)
  const [source, setSource] = useState<SelectedDocument | null>(null)
  const recipients = installed.filter((cap) => cap.manifest.id !== LEGACY_REVIEW && cap.enabled && cap.manifest.permissions.includes('documents.read-selected'))
  const monday = new Date(); monday.setDate(monday.getDate() - (monday.getDay() + 6) % 7)
  const sunday = new Date(monday); sunday.setDate(sunday.getDate() + 6)
  const inWeek = (date: string) => date >= monday.toLocaleDateString('en-CA') && date <= sunday.toLocaleDateString('en-CA')
  useEffect(() => {
    let current = true
    setContentMatches(new Set()); setSearchError(null)
    const timer = window.setTimeout(() => { void searchLibraryContent(query).then((ids) => { if (current) setContentMatches(new Set(ids)) }).catch((reason) => { if (current) setSearchError(String(reason)) }) }, 150)
    return () => { current = false; window.clearTimeout(timer) }
  }, [query, documents])
  useEffect(() => {
    if (!target) return
    setSourceTarget(target.grantId || target.snapshotId ? target : null)
    setSelectedId(target.documentId)
  }, [target])
  const [collapsedCapabilities, setCollapsedCapabilities] = useState<Set<string>>(() => new Set())
  const [collapsedCollections, setCollapsedCollections] = useState<Set<string>>(() => new Set())
  const [collapsedMonths, setCollapsedMonths] = useState<Set<string>>(() => new Set())
  const installedNames = useMemo(() => new Map<string, string>(installed.map((capability): [string, string] => [
    capability.manifest.id,
    capabilityCopy(capability, language).name,
  ]).concat([[CONVERSATION_OWNER, language === 'zh' ? '对话' : 'Conversations']])), [installed, language])
  const tree = useMemo(() => buildLibraryTree(thisWeek ? documents.filter((doc) => inWeek(doc.documentDate)) : documents, installedNames), [documents, installedNames, thisWeek])
  const filteredTree = useMemo(() => filterLibraryTree(tree, query, contentMatches), [tree, query, contentMatches])
  const searching = query.trim().length > 0

  const toggleKey = (current: Set<string>, key: string) => {
    const next = new Set(current)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  }

  useEffect(() => {
    let current = true
    setLoading(true)
    listLibraryDocuments()
      .then((next) => {
        if (!current) return
        setDocuments(next)
        setSelectedId((previous) => previous ?? target?.documentId ?? next[0]?.id ?? null)
        setError(null)
      })
      .catch(() => current && setError(t('libraryLoadFailed')))
      .finally(() => current && setLoading(false))
    return () => { current = false }
  }, [t])

  useEffect(() => {
    let current = true
    setSelectedDocument(null)
    setSource(null)
    setDocumentError(null)
    if (!selectedId) return () => { current = false }
    const read = sourceTarget
      ? readSourceReference(sourceTarget).then((doc) => { if (current) setSource(doc) })
      : readLibraryDocument(selectedId).then((doc) => { if (current) setSelectedDocument(doc) })
    read
      .catch(() => current && setDocumentError(t('libraryDocumentLoadFailed')))
    return () => { current = false }
  }, [selectedId, sourceTarget, t])

  const locale = language === 'zh' ? 'zh-CN' : 'en-US'
  const monthLabel = (month: string) => new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long' })
    .format(new Date(`${month}-01T12:00:00`))

  return (
    <div className="content-column library-page">
      <div className="page-header-row">
        <div><h1 className="library-intro-title">{language === 'zh' ? '认真留下的，' : 'What you choose to keep'}<br /><em>{language === 'zh' ? '值得再读一遍。' : 'is worth returning to.'}</em></h1></div>
        <span className="library-total">{documents.length} {t('libraryDocuments')}</span>
      </div>

      <div className="library-selection-bar">
        <div className="library-period-filter" role="group" aria-label={language === 'zh' ? '资料日期范围' : 'Document date range'}>
          <button aria-pressed={!thisWeek} onClick={() => setThisWeek(false)}>{language === 'zh' ? '全部资料' : 'All documents'}</button>
          <button aria-pressed={thisWeek} onClick={() => setThisWeek(true)}><CalendarIcon />{language === 'zh' ? '本周' : 'This week'}</button>
        </div>
        <div className="library-selection-actions">
          <span className="library-selection-count" aria-live="polite">{selectedInputs.size ? (language === 'zh' ? `已选 ${selectedInputs.size} 篇` : `${selectedInputs.size} selected`) : (language === 'zh' ? '选择资料加入对话' : 'Select documents to discuss')}</span>
          {!!selectedInputs.size && <button className="icon-button" aria-label={language === 'zh' ? '清空选择' : 'Clear selection'} onClick={() => setSelectedInputs(new Set())}><Cross2Icon /></button>}
          {!!recipients.length && <button className="library-grant-action" disabled={!selectedInputs.size} onClick={() => { setRecipient(recipients[0]?.manifest.id ?? ''); setGrantError(null); setGrantOpen(true) }}>{language === 'zh' ? '授权能力读取…' : 'Authorize a capability…'}</button>}
          <button className="library-conversation-action" disabled={!selectedInputs.size || selectedInputs.size > 50} onClick={() => onAddToConversation([...selectedInputs])}><ChatBubbleIcon />{language === 'zh' ? '添加到对话' : 'Add to conversation'}</button>
        </div>
      </div>
      {searchError && <p role="alert">{searchError}</p>}
      {grantOpen && <div className="modal-backdrop"><section className="modal grant-modal" role="dialog" aria-modal="true" aria-labelledby="grant-title"><div className="modal-header"><div><span className="section-kicker">DOCUMENT ACCESS</span><h2 id="grant-title">{language === 'zh' ? '确认资料授权' : 'Confirm document access'}</h2></div><button className="icon-button" disabled={grantBusy} onClick={() => setGrantOpen(false)} aria-label={t('close')}><Cross2Icon /></button></div>
        <p className="modal-copy">{language === 'zh' ? '只授权读取以下资料的当前快照。能力可将这些内容用于 AI 生成；不会获得全库或其他能力私有数据的访问权。' : 'Authorize only the current snapshots listed below. The capability may use them for AI generation; this does not grant access to the entire Library or private capability storage.'}</p>
        <div className="grant-section-label"><span>{language === 'zh' ? '所选资料' : 'Selected documents'}</span><small>{selectedInputs.size}</small></div>
        <ul className="grant-document-list">{documents.filter((doc) => selectedInputs.has(doc.id)).map((doc) => <li key={doc.id}><span className="grant-document-icon"><FileTextIcon /></span><span><strong>{doc.title}</strong><small>{installedNames.get(doc.capabilityId) ?? doc.capabilityName} · {doc.documentDate}</small></span></li>)}</ul>
        <fieldset className="grant-recipients"><legend>{language === 'zh' ? '允许哪个能力读取' : 'Allow access to'}</legend><div className="grant-recipient-list">{recipients.map((cap) => <label className={`grant-recipient ${recipient === cap.manifest.id ? 'is-selected' : ''}`} key={cap.manifest.id}><input type="radio" name="document-recipient" value={cap.manifest.id} checked={recipient === cap.manifest.id} disabled={grantBusy} onChange={() => setRecipient(cap.manifest.id)} /><span className="grant-recipient-icon"><CapabilityIcon name={cap.manifest.icon} /></span><span><strong>{capabilityCopy(cap, language).name}</strong><small>{capabilityCopy(cap, language).description}</small></span><CheckIcon className="grant-recipient-check" aria-hidden="true" /></label>)}</div></fieldset>
        {!recipients.length && <p>{language === 'zh' ? '请先安装并启用支持所选文档读取的能力。' : 'Install and enable a capability that supports selected documents.'}</p>}
        {grantError && <p role="alert">{grantError}</p>}
        <div className="modal-footer"><button className="secondary-button" disabled={grantBusy} onClick={() => setGrantOpen(false)}>{language === 'zh' ? '取消' : 'Cancel'}</button><button className="primary-button" disabled={grantBusy || !recipient} onClick={() => { setGrantBusy(true); void grantSelectedDocuments(recipient, [...selectedInputs]).then(() => { setGrantOpen(false); onOpenCapability(recipient) }).catch((reason) => setGrantError(String(reason))).finally(() => setGrantBusy(false)) }}>{language === 'zh' ? '授权并打开能力' : 'Authorize and open'}<ArrowRightIcon /></button></div>
      </section></div>}
      <div className="library-workspace">
        {loading ? <div className="library-state"><ReloadIcon className="spin" /><span>{t('libraryLoading')}</span></div>
          : error && documents.length === 0 ? <div className="library-state library-state-error"><ExclamationTriangleIcon /><span>{error}</span></div>
            : documents.length === 0 ? <div className="library-state"><ArchiveIcon /><strong>{t('libraryEmpty')}</strong><span>{t('libraryEmptyHint')}</span></div>
              : <>
                <nav className="library-tree" aria-label={t('libraryTree')}>
                  <label className="library-tree-search">
                    <MagnifyingGlassIcon />
                    <input
                      type="search"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder={language === 'zh' ? '搜索标题、正文、来源、集合或日期' : 'Search title, content, source, collection or date'}
                      aria-label={t('librarySearch')}
                    />
                  </label>
                  {filteredTree.length === 0
                    ? <div className="library-search-empty">{t('libraryNoSearchResults')}</div>
                    : filteredTree.map((capability) => {
                      const capabilityExpanded = searching || !collapsedCapabilities.has(capability.capabilityId)
                      return <section className="library-capability-node" key={capability.capabilityId}>
                        <button
                          type="button"
                          className="library-capability-heading"
                          aria-expanded={capabilityExpanded}
                          disabled={searching}
                          onClick={() => setCollapsedCapabilities((current) => toggleKey(current, capability.capabilityId))}
                        >
                          <ChevronRightIcon className={`library-tree-chevron ${capabilityExpanded ? 'is-expanded' : ''}`} />
                          <ArchiveIcon className="library-capability-icon" />
                          <span><strong>{capability.capabilityName}</strong><small>{capability.capabilityId === CONVERSATION_OWNER ? (language === 'zh' ? '平台资料' : 'Platform documents') : capability.installed ? t('libraryInstalledSource') : t('libraryUninstalledSource')}</small></span>
                          <em>{capability.documentCount}</em>
                        </button>
                        {capabilityExpanded && capability.collections.map((collection) => {
                          const collectionId = `${capability.capabilityId}/${collection.key}`
                          const showCollection = capability.collections.length > 1
                          const collectionExpanded = !showCollection || searching || !collapsedCollections.has(collectionId)
                          return <div className={`library-collection-node ${showCollection ? '' : 'is-flat'}`} key={collection.key}>
                            {showCollection && <button
                              type="button"
                              className="library-collection-heading"
                              aria-expanded={collectionExpanded}
                              disabled={searching}
                              onClick={() => setCollapsedCollections((current) => toggleKey(current, collectionId))}
                            >
                              <ChevronRightIcon className={`library-tree-chevron ${collectionExpanded ? 'is-expanded' : ''}`} />
                              <strong>{collection.name}</strong><span>{collection.documentCount}</span>
                            </button>}
                            {collectionExpanded && collection.months.map((month) => {
                              const monthId = `${collectionId}/${month.key}`
                              const monthExpanded = searching || !collapsedMonths.has(monthId)
                              return <div className="library-month-node" key={month.key}>
                                <button
                                  type="button"
                                  className="library-month-label"
                                  aria-expanded={monthExpanded}
                                  disabled={searching}
                                  onClick={() => setCollapsedMonths((current) => toggleKey(current, monthId))}
                                >
                                  <ChevronRightIcon className={`library-tree-chevron ${monthExpanded ? 'is-expanded' : ''}`} />
                                  <span>{monthLabel(month.key)}</span>
                                </button>
                                {monthExpanded && month.documents.map((document) => <div className="library-selectable-document" key={document.id}><input type="checkbox" aria-label={`${language === 'zh' ? '选择' : 'Select'} ${document.title}`} checked={selectedInputs.has(document.id)} onChange={() => setSelectedInputs((current) => toggleKey(current, document.id))} /><button
                                  type="button"
                                  key={document.id}
                                  className={`library-document-link ${selectedId === document.id ? 'is-active' : ''}`}
                                  onClick={() => { setSourceTarget(null); setSelectedId(document.id) }}
                                >
                                  <FileTextIcon /><span><strong>{document.title}</strong><small>{document.documentDate}</small></span>
                                </button></div>)}
                              </div>
                            })}
                          </div>
                        })}
                      </section>
                    })}
                </nav>

                <article className="library-reader">
                  {source ? <><header className="library-reader-header"><span>{language === 'zh' ? '引用原文 · 使用时保存的快照' : 'Cited source · snapshot captured when used'}</span><h2>{source.reference.title}</h2><small>{source.documentDate} · {source.reference.revision}</small><button className="quiet-button" onClick={() => { setSourceTarget(null); setSelectedId(source.reference.documentId) }}>{language === 'zh' ? '查看当前文档' : 'View current document'}</button></header><div className="library-reader-content"><div className="library-reader-document"><LibraryMarkdown content={source.content} onDocument={onDocument} /></div></div></> : selectedDocument ? <>
                    <header className="library-reader-header">
                      <div><span>{selectedDocument.collectionName}</span><h2>{selectedDocument.title}</h2></div>
                      <div className="library-reader-meta"><span>{installedNames.get(selectedDocument.capabilityId) ?? selectedDocument.capabilityName}</span><small>{t('libraryUpdated')} {new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(selectedDocument.updatedAt))}</small></div>
                    </header>
                    <div className="library-reader-content"><div className="library-reader-document"><LibraryMarkdown content={selectedDocument.content} onDocument={onDocument} /></div></div>
                  </> : documentError ? <div className="library-state library-state-error"><ExclamationTriangleIcon /><span>{documentError}</span></div> : <div className="library-state"><FileTextIcon /><span>{t('librarySelectDocument')}</span></div>}
                </article>
              </>}
      </div>
    </div>
  )
}

function CapabilitiesPage({ installed, onRefresh, onOpenCapability, onNotice }: { installed: InstalledCapability[]; onRefresh: () => Promise<void>; onOpenCapability: (id: string) => void; onNotice: (message: string) => void }) {
  const { t } = useTranslation()
  const { language } = useWorkbench()
  const [importOpen, setImportOpen] = useState(false)
  const [guideOpen, setGuideOpen] = useState(false)
  const [filter, setFilter] = useState<CapabilityFilter>('all')
  const available = listAvailableCapabilities()
  const installedById = new Map(installed.map((capability) => [capability.manifest.id, capability]))
  const enabledCount = installed.filter((capability) => capability.enabled).length
  const disabledCount = installed.length - enabledCount
  const filters: Array<{ id: CapabilityFilter; label: string; count: number }> = [
    { id: 'all', label: t('all'), count: available.length },
    { id: 'enabled', label: t('enabled'), count: enabledCount },
    { id: 'disabled', label: t('disabled'), count: disabledCount },
  ]
  const filteredCapabilities = available.filter((capability) => {
    const current = installedById.get(capability.manifest.id)
    return filter === 'all' || (filter === 'enabled' ? current?.enabled === true : current?.enabled === false)
  })

  const install = async (id: string) => {
    try {
      await installCapabilityPackage(id)
      await onRefresh()
      onNotice(t('capabilityInstalled'))
    } catch (error) {
      onNotice(error instanceof Error ? error.message : t('capabilityInstallFailed'))
    }
  }

  const toggle = async (id: string, enabled: boolean) => {
    try {
      await setCapabilityPackageEnabled(id, enabled)
      await onRefresh()
      onNotice(enabled ? t('capabilityEnabled') : t('capabilityDisabled'))
    } catch (error) {
      onNotice(error instanceof Error ? error.message : t('capabilityUpdateFailed'))
    }
  }

  const rollback = async (id: string) => {
    try { await rollbackCapabilityPackage(id); await onRefresh() }
    catch (error) { onNotice(String(error)) }
  }

  const uninstall = async (id: string) => {
    try {
      await uninstallCapabilityPackage(id)
      await onRefresh()
      onNotice(t('capabilityUninstalled'))
    } catch (error) {
      onNotice(error instanceof Error ? error.message : t('capabilityUpdateFailed'))
    }
  }

  return (
    <div className="content-column capabilities-page">
      <div className="page-header-row">
        <div><h1 className="capabilities-intro-title">{t('capabilitiesHeadline')}</h1><p>{t('capabilitiesIntro')}</p></div>
        <button className="primary-button" onClick={() => setImportOpen(true)}><PlusIcon />{t('importCapability')}</button>
      </div>

      <div className="capability-toolbar">
        <div className="capability-filters" role="group" aria-label={t('filterCapabilities')}>
          {filters.map((option) => <button key={option.id} className={`filter-chip ${filter === option.id ? 'active' : ''}`} aria-pressed={filter === option.id} onClick={() => setFilter(option.id)}>{option.label} <span>{option.count}</span></button>)}
        </div>
        <div className="toolbar-spacer" />
        <button className="quiet-button" onClick={() => setGuideOpen(true)}><CodeIcon />{t('developerGuide')}</button>
      </div>

      {installed.length === 0 && filter === 'all' && <section className="capability-empty">
        <div className="capability-empty-art" aria-hidden="true"><div className="art-window"><span /><span /><span /></div><div className="art-plus"><PlusIcon /></div></div>
        <div className="capability-empty-copy"><h2>{t('quietWorkbench')}</h2><p>{t('capabilityModulesCopy')}</p><button className="text-button" onClick={() => setImportOpen(true)}>{t('importLocalCapability')}<ArrowRightIcon /></button></div>
      </section>}

      <section className="capability-catalog" aria-label={t('availableCapabilities')}>
        <div className="section-heading-row"><div><span className="section-kicker">AVAILABLE PACKAGES</span><h2>{t('availableCapabilities')}</h2></div></div>
        <div className="capability-cards">
          {filteredCapabilities.map((capability) => {
            const current = installedById.get(capability.manifest.id)
            const copy = capabilityCopy(capability, language)
            return <article className="capability-card" key={capability.manifest.id}>
              <div className="capability-card-icon"><CapabilityIcon name={capability.manifest.icon} /></div>
              <div className="capability-card-copy"><div className="capability-card-title"><h3>{copy.name}</h3><span className={`capability-status ${current ? current.enabled ? 'enabled' : 'disabled' : 'available'}`}>{current ? current.enabled ? t('enabled') : t('disabled') : t('available')}</span></div><p>{copy.description}</p><small>{capability.manifest.id} · v{capability.manifest.version}</small>{getCapabilityLoadError(capability.manifest.id) && <p role="alert">{getCapabilityLoadError(capability.manifest.id)}</p>}</div>
              <div className="capability-card-actions">{current ? <><button className="quiet-button" onClick={() => onOpenCapability(capability.manifest.id)} disabled={!current.enabled || Boolean(getCapabilityLoadError(capability.manifest.id))}>{t('openCapability')}<ArrowRightIcon /></button><button className="quiet-button" onClick={() => void toggle(capability.manifest.id, !current.enabled)}>{current.enabled ? t('disableCapability') : t('enableCapability')}</button>{current.previousPackageVersion && <button className="quiet-button" onClick={() => void rollback(capability.manifest.id)}>{language === 'zh' ? '回退版本' : 'Roll back'}</button>}<button className="capability-uninstall" onClick={() => void uninstall(capability.manifest.id)}>{t('uninstallCapability')}</button></> : <button className="primary-button" onClick={() => void install(capability.manifest.id)}>{t('installCapability')}<ArrowRightIcon /></button>}</div>
            </article>
          })}
          {filteredCapabilities.length === 0 && <div className="capability-filter-empty"><span>{t('noFilteredCapabilities')}</span><button className="text-button" onClick={() => setFilter('all')}>{t('showAllCapabilities')}<ArrowRightIcon /></button></div>}
        </div>
      </section>

      <AnimatePresence>
        {guideOpen && <DeveloperGuideModal onClose={() => setGuideOpen(false)} />}
        {importOpen && <PackageImportModal language={language} onClose={() => setImportOpen(false)} onInstalled={async () => { await onRefresh(); onNotice(t('capabilityInstalled')) }} />}
      </AnimatePresence>
    </div>
  )
}

function DeveloperGuideModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const sections = [
    { title: t('developerGuideStructure'), copy: t('developerGuideStructureCopy') },
    { title: t('developerGuideHost'), copy: t('developerGuideHostCopy') },
    { title: t('developerGuideLifecycle'), copy: t('developerGuideLifecycleCopy') },
  ]

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <motion.section className="modal developer-guide-modal" role="dialog" aria-modal="true" aria-labelledby="developer-guide-title" initial={{ opacity: 0, scale: 0.97, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98, y: 6 }}>
        <div className="modal-header"><div><span className="section-kicker">CAPABILITY DEVELOPMENT</span><h2 id="developer-guide-title">{t('developerGuideTitle')}</h2></div><button className="icon-button" onClick={onClose} aria-label={t('close')}><Cross2Icon /></button></div>
        <p className="modal-copy">{t('developerGuideIntro')}</p>
        <div className="developer-guide-list">
          {sections.map((section, index) => <section className="developer-guide-item" key={section.title}><span>{index + 1}</span><div><h3>{section.title}</h3><p>{section.copy}</p></div></section>)}
        </div>
        <p className="developer-guide-reference">{t('developerGuideReference')}</p>
        <div className="modal-footer"><button className="primary-button" onClick={onClose}>{t('understood')}</button></div>
      </motion.section>
    </div>
  )
}

function SettingsPage({ onNotice, providerStatus, onSelectProvider, onCheckProvider }: { onNotice: (message: string) => void; providerStatus: ProviderStatus | null; onSelectProvider: (kind: ProviderKind) => Promise<void>; onCheckProvider: () => Promise<ProviderStatus> }) {
  const { t } = useTranslation()
  const { theme, setTheme, language, setLanguage, providerKind } = useWorkbench()
  const [checking, setChecking] = useState(false)
  const [testingProvider, setTestingProvider] = useState(false)

  const runCheck = async () => {
    setChecking(true)
    const nextStatus = await onCheckProvider()
    setChecking(false)
    onNotice(nextStatus.state === 'ready' ? t('providerHealthy') : nextStatus.state === 'error' ? t('providerNeedsAttention') : t('providerCheckIncomplete'))
  }

  const testProvider = async () => {
    setTestingProvider(true)
    try {
      const result = await testSelectedProvider(language)
      onNotice(`${result.provider} · ${result.model} ${t('providerReturned')}`)
    } catch (error) {
      onNotice(error instanceof Error ? error.message : t('providerTestFailed'))
    } finally {
      setTestingProvider(false)
    }
  }

  return (
    <div className="content-column settings-page">
      <div className="page-header-row"><div><div className="eyebrow">{t('preferences')}</div><h1>{t('settings')}</h1><p>{t('settingsIntro')}</p></div></div>

      <section className="settings-section"><div className="settings-section-heading"><span className="settings-number">01</span><div><h2>AI Provider</h2><p>{t('providerShared')}</p></div></div>
        <div className="provider-options">
          {(['codex-api', 'codex-subscription', 'compatible-api'] as ProviderKind[]).map((kind) => (
            <button key={kind} className={`provider-option ${providerKind === kind ? 'selected' : ''}`} onClick={() => void onSelectProvider(kind)}>
              <span className="provider-option-icon">{kind === 'compatible-api' ? <GlobeIcon /> : kind === 'codex-api' ? <LightningBoltIcon /> : <CodeIcon />}</span>
              <span><strong>{providerLabel(t, kind)}</strong><small>{kind === 'codex-api' ? t('apiDescription') : kind === 'codex-subscription' ? t('subscriptionDescription') : t('compatibleDescription')}</small></span>
              {providerKind === kind && <CheckIcon className="selected-check" />}
            </button>
          ))}
        </div>
        <div className="provider-detail"><div className="detail-icon"><UpdateIcon /></div><div><strong>{providerStatus?.label ?? providerLabel(t, providerKind)} · {providerStateLabel(t, providerStatus?.state)}</strong><span>{providerStatus?.detail ?? t('providerStatusLoading')}</span></div><div className="provider-detail-actions"><button className="quiet-button" onClick={runCheck} disabled={checking}>{checking ? t('checkingEllipsis') : t('healthCheck')}<ReloadIcon className={checking ? 'spin' : ''} /></button><button className="quiet-button" onClick={testProvider} disabled={testingProvider}>{testingProvider ? t('testingEllipsis') : t('testCall')}<ArrowRightIcon /></button></div></div>
        <div className="settings-callout"><LockClosedIcon /><div><strong>{t('credentialsStayInHost')}</strong><span>{t('credentialsCopy')}</span></div></div>
      </section>

      <section className="settings-section"><div className="settings-section-heading"><span className="settings-number">02</span><div><h2>{t('appearance')}</h2><p>{t('appearanceIntro')}</p></div></div><div className="theme-options"><button className={`theme-option ${theme === 'light' ? 'selected' : ''}`} onClick={() => setTheme('light')}><span className="theme-preview theme-preview-light"><SunIcon /></span><span><strong>{t('light')}</strong><small>{t('lightDescription')}</small></span>{theme === 'light' && <CheckIcon className="selected-check" />}</button><button className={`theme-option ${theme === 'dark' ? 'selected' : ''}`} onClick={() => setTheme('dark')}><span className="theme-preview theme-preview-dark"><MoonIcon /></span><span><strong>{t('dark')}</strong><small>{t('darkDescription')}</small></span>{theme === 'dark' && <CheckIcon className="selected-check" />}</button></div></section>

      <section className="settings-section"><div className="settings-section-heading"><span className="settings-number">03</span><div><h2>{t('language')}</h2><p>{t('languageIntro')}</p></div></div><div className="theme-options language-options"><button className={`theme-option ${language === 'zh' ? 'selected' : ''}`} onClick={() => setLanguage('zh')}><span className="language-preview">中</span><span><strong>{t('chinese')}</strong><small>{t('chineseDescription')}</small></span>{language === 'zh' && <CheckIcon className="selected-check" />}</button><button className={`theme-option ${language === 'en' ? 'selected' : ''}`} onClick={() => setLanguage('en')}><span className="language-preview">EN</span><span><strong>{t('english')}</strong><small>{t('englishDescription')}</small></span>{language === 'en' && <CheckIcon className="selected-check" />}</button></div></section>

      <section className="settings-section"><div className="settings-section-heading"><span className="settings-number">04</span><div><h2>{t('localData')}</h2><p>{t('localDataIntro')}</p></div></div><div className="data-row"><div className="data-row-icon"><FileTextIcon /></div><div><strong>{t('defaultWorkspace')}</strong><span>{t('personalWorkspaceLocal')}</span></div><span className="data-row-value">{t('ready')}</span><ChevronRightIcon /></div></section>
    </div>
  )
}

function CommandPalette({ onClose, onNavigate, onNotice, theme, onToggleTheme }: { onClose: () => void; onNavigate: (view: View) => void; onNotice: (message: string) => void; theme: Theme; onToggleTheme: () => void }) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => inputRef.current?.focus(), [])

  const commands = useMemo(() => [
    { label: t('openToday'), hint: t('navigation'), icon: CalendarIcon, action: () => onNavigate('today') },
    { label: i18n.language.startsWith('zh') ? '打开对话' : 'Open conversations', hint: t('navigation'), icon: ChatBubbleIcon, action: () => onNavigate('conversations') },
    { label: t('openLibrary'), hint: t('navigation'), icon: ArchiveIcon, action: () => onNavigate('library') },
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

export { App }
