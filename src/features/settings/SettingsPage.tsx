import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowRightIcon, CheckIcon, MoonIcon, SunIcon } from '@radix-ui/react-icons'
import type { InstalledCapability } from '../../platform/capability-host.ts'
import { isDesktopHost, testCapabilityAgent, type AgentTool } from '../../platform/agent-tools.ts'
import { useWorkbench, type View } from '../../platform/preferences.ts'
import { DataManagement } from './DataManagement.tsx'
import { agentNote, agentStanding, chosenAgent, selectableAgents, type AgentStanding } from './agent-standing.ts'
import { notesFor, visibleSections, type SettingsGroup, type SettingsSectionId } from './settings-sections.ts'

type SettingsPageProps = {
  installed: InstalledCapability[]
  onNotice: (message: string) => void
  onNavigate: (view: View) => void
  agents: AgentTool[]
  capabilityAgent: string
  onChooseAgent: (id: string) => Promise<void>
  onRefreshAgents: () => void
}

export function SettingsPage({ installed, onNotice, onNavigate, agents, capabilityAgent, onChooseAgent, onRefreshAgents }: SettingsPageProps) {
  const { t } = useTranslation()
  const { theme, setTheme, language, setLanguage } = useWorkbench()
  const [testing, setTesting] = useState(false)
  const desktop = isDesktopHost()
  const chosen = chosenAgent(agents, capabilityAgent)

  const runTest = async () => {
    setTesting(true)
    try {
      const result = await testCapabilityAgent(language)
      onNotice([result.provider, result.model].filter(Boolean).join(' · ') + ` ${t('agentAnswered')}`)
    } catch (error) {
      onNotice(error instanceof Error ? error.message : t('agentSaveFailed'))
    } finally {
      setTesting(false)
      onRefreshAgents()
    }
  }

  // One renderer per section id, so the grouping stays data and the layout stays markup.
  const body: Partial<Record<SettingsSectionId, ReactNode>> = {
    'agent-tools': (
      <div className="agent-list">
        {agents.length === 0 && <p className="settings-group-empty">{t(desktop ? 'agentNoAgents' : 'agentPreviewNote')}</p>}
        {agents.map((tool) => <AgentRow key={tool.id} tool={tool} desktop={desktop} />)}
      </div>
    ),
    'skills': (
      <div className="settings-linked-row">
        <button className="quiet-button" onClick={() => onNavigate('skills')}>{t('sectionSkillsOpen')}<ArrowRightIcon /></button>
      </div>
    ),
    'model-access': (
      <>
        <div className="provider-options">
          {selectableAgents(agents).map((tool) => (
            <button key={tool.id} className={`provider-option ${capabilityAgent === tool.id ? 'selected' : ''}`} disabled={!tool.servesCapabilities} onClick={() => void onChooseAgent(tool.id)}>
              <span><strong>{tool.name}</strong><small>{t(agentNote(tool, agentStanding(tool, desktop)).key, agentNote(tool, agentStanding(tool, desktop)).values)}</small></span>
              {capabilityAgent === tool.id && <CheckIcon className="selected-check" />}
            </button>
          ))}
          {selectableAgents(agents).length === 0 && <p className="settings-group-empty">{t(desktop ? 'agentChooseNone' : 'agentPreviewNote')}</p>}
        </div>
        <ScopeNotes section="model-access" />
        {chosen && (
          <div className="provider-detail">
            <div><strong>{chosen.name}</strong><span>{t(agentNote(chosen, agentStanding(chosen, desktop)).key, agentNote(chosen, agentStanding(chosen, desktop)).values)}</span></div>
            <div className="provider-detail-actions">
              <button className="quiet-button" onClick={runTest} disabled={testing || !desktop}>{testing ? t('agentTesting') : t('agentRunTest')}<ArrowRightIcon /></button>
            </div>
          </div>
        )}
      </>
    ),
    'appearance': (
      <div className="theme-options">
        <button className={`theme-option ${theme === 'light' ? 'selected' : ''}`} onClick={() => setTheme('light')}><span className="theme-preview theme-preview-light"><SunIcon /></span><span><strong>{t('light')}</strong><small>{t('lightDescription')}</small></span>{theme === 'light' && <CheckIcon className="selected-check" />}</button>
        <button className={`theme-option ${theme === 'dark' ? 'selected' : ''}`} onClick={() => setTheme('dark')}><span className="theme-preview theme-preview-dark"><MoonIcon /></span><span><strong>{t('dark')}</strong><small>{t('darkDescription')}</small></span>{theme === 'dark' && <CheckIcon className="selected-check" />}</button>
      </div>
    ),
    'language': (
      <div className="theme-options language-options">
        <button className={`theme-option ${language === 'zh' ? 'selected' : ''}`} onClick={() => setLanguage('zh')}><span className="language-preview">中</span><span><strong>{t('chinese')}</strong><small>{t('chineseDescription')}</small></span>{language === 'zh' && <CheckIcon className="selected-check" />}</button>
        <button className={`theme-option ${language === 'en' ? 'selected' : ''}`} onClick={() => setLanguage('en')}><span className="language-preview">EN</span><span><strong>{t('english')}</strong><small>{t('englishDescription')}</small></span>{language === 'en' && <CheckIcon className="selected-check" />}</button>
      </div>
    ),
    'local-data': <DataManagement language={language} installed={installed} />,
  }

  return (
    <div className="content-column settings-page">
      <div className="page-header-row"><div><div className="eyebrow">{t('preferences')}</div><h1>{t('settings')}</h1><p>{t('settingsIntro')}</p></div></div>
      <SettingsGroupView group="machine" desktop={desktop} body={body} />
      <SettingsGroupView group="nooki" desktop={desktop} body={body} />
    </div>
  )
}

function AgentRow({ tool, desktop }: { tool: AgentTool; desktop: boolean }) {
  const { t } = useTranslation()
  const standing = agentStanding(tool, desktop)
  const note = agentNote(tool, standing)
  return (
    <div className={`agent-row agent-row-${standing}`}>
      <div className="agent-row-name">
        <strong>{tool.name}</strong>
        <span className={`pill pill-${standing}`}>{t(standingLabel(standing))}</span>
      </div>
      <p className="agent-row-note">{t(note.key, note.values)}</p>
      <p className="agent-row-path"><span>{t('agentSkillsDirectory')}</span><code>{tool.directory}</code></p>
    </div>
  )
}

function standingLabel(standing: AgentStanding): string {
  return `agent${standing.charAt(0).toUpperCase()}${standing.slice(1)}`
}

const SECTION_TITLE: Record<SettingsSectionId, string> = {
  'agent-tools': 'sectionAgentTools',
  'skills': 'sectionSkills',
  'mcp': 'sectionMcp',
  'conventions': 'sectionConventions',
  'model-access': 'modelAccess',
  'appearance': 'appearance',
  'language': 'language',
  'local-data': 'localData',
}

const SECTION_INTRO: Record<SettingsSectionId, string> = {
  'agent-tools': 'sectionAgentToolsIntro',
  'skills': 'sectionSkillsIntro',
  'mcp': 'sectionMcpIntro',
  'conventions': 'sectionConventionsIntro',
  'model-access': 'modelAccessIntro',
  'appearance': 'appearanceIntro',
  'language': 'languageIntro',
  'local-data': 'localDataIntro',
}

function SettingsGroupView({ group, desktop, body }: { group: SettingsGroup; desktop: boolean; body: Partial<Record<SettingsSectionId, ReactNode>> }) {
  const { t } = useTranslation()
  const sections = visibleSections(group, desktop)
  const hidden = !desktop && group === 'machine'
  if (!sections.length && !hidden) return null

  return (
    <section className={`settings-group settings-group-${group}`} aria-label={t(group === 'machine' ? 'machineGroup' : 'nookiGroup')}>
      <header className="settings-group-heading">
        <h2>{t(group === 'machine' ? 'machineGroup' : 'nookiGroup')}</h2>
        <p>{t(group === 'machine' ? 'machineGroupIntro' : 'nookiGroupIntro')}</p>
      </header>
      {hidden && <p className="settings-group-empty">{t('machinePreviewOnly')}</p>}
      {sections.map((section, index) => (
        <section key={section.id} className={`settings-section ${section.reserved ? 'is-reserved' : ''}`}>
          <div className="settings-section-heading">
            <span className="settings-number">{String(index + 1).padStart(2, '0')}</span>
            <div>
              <h3>{t(SECTION_TITLE[section.id])}{section.reserved && <span className="settings-reserved-tag">{t('sectionReserved')}</span>}</h3>
              <p>{t(SECTION_INTRO[section.id])}</p>
            </div>
          </div>
          {body[section.id]}
        </section>
      ))}
    </section>
  )
}

function ScopeNotes({ section }: { section: SettingsSectionId }) {
  const { t } = useTranslation()
  const notes = notesFor(section)
  if (!notes.length) return null
  return (
    <ul className="settings-scope-notes">
      {notes.map((note) => <li key={note.id}>{t(note.id === 'conversations' ? 'scopeNoteConversations' : 'scopeNoteQuota')}</li>)}
    </ul>
  )
}
