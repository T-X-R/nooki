import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { CheckCircledIcon } from '@radix-ui/react-icons'
import type { DocumentReference } from '../../packages/capability-contract/src/index.ts'
import { getCapabilityAgent, listAgentTools, setCapabilityAgent, type AgentTool } from '../platform/agent-tools.ts'
import type { InstalledCapability } from '../platform/capability-host.ts'
import { getCapabilityModule, getInstalledCapabilityPackagesWithState } from '../platform/capability-runtime.ts'
import { libraryOrganization } from '../platform/document-library.ts'
import { emptyOrganization, type Organization } from '../platform/library-store.ts'
import { taskRunner } from '../platform/tasks.ts'
import i18n from '../shared/i18n.ts'
import { CONVERSATION_OWNER, LEGACY_REVIEW } from '../features/conversation/conversation-model.ts'
import { ConversationPage } from '../features/conversation/ConversationPage.tsx'
import { TodayPage } from '../features/activity/TodayPage.tsx'
import { CapabilitiesPage } from '../features/capabilities/CapabilitiesPage.tsx'
import { CapabilityErrorBoundary, CapabilityPage } from '../features/capabilities/CapabilityPage.tsx'
import { LibraryPage } from '../features/library/LibraryPage.tsx'
import { SettingsPage } from '../features/settings/SettingsPage.tsx'
import { SkillPoolPage } from '../features/skills/SkillPoolPage.tsx'
import { TaskPage } from '../features/tasks/TaskPage.tsx'
import { CommandPalette } from './CommandPalette.tsx'
import { Sidebar } from './Sidebar.tsx'
import { Topbar } from './Topbar.tsx'
import { WindowTitlebar } from './WindowTitlebar.tsx'
import { takeSubstrateNotice, useWorkbench, type View } from '../platform/preferences.ts'

function App() {
  const { t } = useTranslation()
  const { view, theme, language, setView, setTheme } = useWorkbench()
  const [libraryTopicId, setLibraryTopicId] = useState('')
  const [organization, setOrganization] = useState<Organization>(emptyOrganization)
  const [organizationError, setOrganizationError] = useState('')
  useEffect(() => {
    let current = true
    const load = () => { void libraryOrganization().then((value) => { if (current) { setOrganization(value); setOrganizationError(''); setLibraryTopicId((id) => value.topics.some((topic) => topic.id === id) ? id : '') } }).catch((reason) => { if (current) setOrganizationError(String(reason)) }) }
    load(); window.addEventListener('workbench:library-changed', load)
    return () => { current = false; window.removeEventListener('workbench:library-changed', load) }
  }, [])
  const [conversationTarget, setConversationTarget] = useState<string | null>(null)
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
  const [conversationDocuments, setConversationDocuments] = useState<string[]>([])
  const [documentTarget, setDocumentTarget] = useState<DocumentReference | null>(null)
  const [taskTarget, setTaskTarget] = useState<string | null>(null)
  const [commandOpen, setCommandOpen] = useState(false)
  const [agents, setAgents] = useState<AgentTool[]>([])
  const [capabilityAgent, setChosenAgent] = useState('codex')
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

  const refreshAgents = () => {
    void Promise.all([listAgentTools(), getCapabilityAgent()]).then(([tools, chosen]) => { setAgents(tools); setChosenAgent(chosen) })
  }
  useEffect(refreshAgents, [])

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

  useEffect(() => { if (takeSubstrateNotice()) showNotice(t('agentMigrated')) }, [])

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
    setLibraryTopicId('')
    setDocumentTarget(reference)
    navigate('library')
  }
  useEffect(() => {
    const open = (event: Event) => openDocument((event as CustomEvent<DocumentReference>).detail)
    const conversation = (event: Event) => { setConversationTarget((event as CustomEvent<string>).detail); navigate('conversations') }
    window.addEventListener('workbench:open-conversation', conversation)
    window.addEventListener('workbench:open-document', open)
    return () => { window.removeEventListener('workbench:open-document', open); window.removeEventListener('workbench:open-conversation', conversation) }
  }, [])

  const chooseAgent = async (id: string) => {
    try {
      await setCapabilityAgent(id)
      setChosenAgent(id)
    } catch {
      showNotice(t('agentSaveFailed'))
    }
  }

  return (
    <div className="app-shell">
      <WindowTitlebar />
      <div className="app-workspace">
        <Sidebar organization={organization} organizationError={organizationError} libraryTopicId={libraryTopicId} onSelectTopic={(id) => { setLibraryTopicId(id); setDocumentTarget(null); navigate('library') }} activeConversationId={activeConversationId} onOpenConversation={(id) => { setConversationTarget(id ?? 'new'); navigate('conversations') }} activeView={view} activeCapabilityId={activeCapabilityId} installed={installedCapabilities.filter((cap) => cap.manifest.id !== LEGACY_REVIEW)} onNavigate={navigate} onOpenCapability={openCapability} />
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
              {view === 'today' && <TodayPage installed={installedCapabilities.filter((cap) => cap.manifest.id !== LEGACY_REVIEW)} onNavigate={navigate} onOpenCapability={openCapability} onDocument={openDocument} onTask={(id) => { setTaskTarget(id); navigate('tasks') }} agents={agents} capabilityAgent={capabilityAgent} />}
              {view === 'conversations' && <ConversationPage onSelected={setActiveConversationId} language={language} targetId={conversationTarget} onTargetConsumed={() => setConversationTarget(null)} incomingIds={conversationDocuments} onConsumed={() => setConversationDocuments([])} onDocument={openDocument} />}
              {view === 'tasks' && <TaskPage onOpenConversation={(id) => { setConversationTarget(id); navigate('conversations') }} language={language} installed={installedCapabilities} selectedId={taskTarget} onOpenCapability={openCapability} />}
              {view === 'skills' && <SkillPoolPage language={language} />}
              {view === 'library' && <LibraryPage topicId={libraryTopicId} organization={organization} onSelectTopic={setLibraryTopicId} onAddToConversation={(ids) => { setConversationDocuments(ids); navigate('conversations') }} installed={installedCapabilities} target={documentTarget} onOpenCapability={openCapability} onDocument={openDocument} />}
              {view === 'capabilities' && <CapabilitiesPage installed={installedCapabilities.filter((cap) => cap.manifest.id !== LEGACY_REVIEW)} onRefresh={refreshCapabilities} onOpenCapability={openCapability} onNotice={showNotice} />}
              {view === 'capability' && activeCapabilityId && getCapabilityModule(activeCapabilityId) && <CapabilityErrorBoundary key={`${activeCapabilityId}:${getCapabilityModule(activeCapabilityId)!.manifest.version}`} onBack={() => navigate('capabilities')} language={language}><CapabilityPage module={getCapabilityModule(activeCapabilityId)!} /></CapabilityErrorBoundary>}
              {view === 'settings' && <SettingsPage onOpenConversation={(id) => { setConversationTarget(id); navigate('conversations') }} installed={installedCapabilities} onNotice={showNotice} agents={agents} capabilityAgent={capabilityAgent} onChooseAgent={chooseAgent} onRefreshAgents={refreshAgents} />}
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

export { App }
