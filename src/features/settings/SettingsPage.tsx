import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowRightIcon, CheckIcon, MoonIcon, SunIcon } from '@radix-ui/react-icons'
import type { InstalledCapability } from '../../platform/capability-host.ts'
import { isDesktopHost, testCapabilityAgent, type AgentTool } from '../../platform/agent-tools.ts'
import { useWorkbench } from '../../platform/preferences.ts'
import { DataManagement } from './DataManagement.tsx'
import { agentNote, agentStanding, canChoose, listedAgents } from './agent-standing.ts'
import { notesFor, visibleSections, type SettingsSectionId } from './settings-sections.ts'

type SettingsPageProps = {
  installed: InstalledCapability[]
  onNotice: (message: string) => void
  agents: AgentTool[]
  capabilityAgent: string
  onChooseAgent: (id: string) => Promise<void>
  onRefreshAgents: () => void
}

export function SettingsPage({ installed, onNotice, agents, capabilityAgent, onChooseAgent, onRefreshAgents }: SettingsPageProps) {
  const { t } = useTranslation()
  const { theme, setTheme, language, setLanguage } = useWorkbench()
  const [testing, setTesting] = useState(false)
  const desktop = isDesktopHost()
  const listed = listedAgents(agents)

  const runTest = async () => {
    setTesting(true)
    try {
      const result = await testCapabilityAgent(language)
      onNotice(`${[result.provider, result.model].filter(Boolean).join(' · ')} ${t('agentAnswered')}`)
    } catch (error) {
      onNotice(error instanceof Error ? error.message : t('agentSaveFailed'))
    } finally {
      setTesting(false)
      onRefreshAgents()
    }
  }

  // One renderer per section id, so the order stays data and the layout stays markup.
  const body: Partial<Record<SettingsSectionId, ReactNode>> = {
    'agent-access': (
      <div className="agent-access">
        {listed.length === 0
          ? <p className="settings-empty">{t('agentNoAgents')}</p>
          : <ul className="agent-list">
              {listed.map((tool) => {
                const standing = agentStanding(tool, desktop)
                const note = agentNote(tool, standing)
                const selected = capabilityAgent === tool.id
                const choosable = canChoose(tool)
                return (
                  <li key={tool.id}>
                    <button
                      type="button"
                      className={`agent-option ${selected ? 'is-selected' : ''} ${choosable ? '' : 'is-unavailable'}`}
                      role="radio"
                      aria-checked={selected}
                      disabled={!choosable}
                      onClick={() => void onChooseAgent(tool.id)}
                    >
                      <span className="agent-mark" aria-hidden="true">{selected && <CheckIcon />}</span>
                      <span className="agent-body">
                        <strong>{tool.name}</strong>
                        <small>{t(note.key, note.values)}</small>
                      </span>
                      {!choosable && <span className="agent-tag">{t('agentNotInstalled')}</span>}
                    </button>
                  </li>
                )
              })}
            </ul>}
        <ScopeNotes section="agent-access" />
        {listed.some(canChoose) && (
          <div className="agent-actions">
            <button className="quiet-button" onClick={runTest} disabled={testing || !desktop}>{testing ? t('agentTesting') : t('agentRunTest')}<ArrowRightIcon /></button>
            <span>{t('agentRunTestNote')}</span>
          </div>
        )}
      </div>
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
      {visibleSections(desktop).map((section, index) => (
        <section key={section.id} className="settings-section">
          <div className="settings-section-heading">
            <span className="settings-number">{String(index + 1).padStart(2, '0')}</span>
            <div>
              <h2>{t(SECTION_TITLE[section.id])}</h2>
              <p>{t(SECTION_INTRO[section.id])}</p>
            </div>
          </div>
          {body[section.id]}
        </section>
      ))}
    </div>
  )
}

const SECTION_TITLE: Record<SettingsSectionId, string> = {
  'agent-access': 'agentAccess',
  'appearance': 'appearance',
  'language': 'language',
  'local-data': 'localData',
}

const SECTION_INTRO: Record<SettingsSectionId, string> = {
  'agent-access': 'agentAccessIntro',
  'appearance': 'appearanceIntro',
  'language': 'languageIntro',
  'local-data': 'localDataIntro',
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
