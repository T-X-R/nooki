import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowRightIcon, CheckIcon, CodeIcon, GlobeIcon, LightningBoltIcon, MoonIcon, ReloadIcon, SunIcon, UpdateIcon } from '@radix-ui/react-icons'
import type { InstalledCapability } from '../../platform/capability-host.ts'
import { isDesktopHost, testSelectedProvider, type ProviderKind, type ProviderStatus } from '../../platform/ai-provider.ts'
import { useWorkbench, type View } from '../../platform/preferences.ts'
import { CompatibleEndpointSettings } from './CompatibleEndpointSettings.tsx'
import { DataManagement } from './DataManagement.tsx'
import { providerLabel, providerStateLabel } from './provider-labels.ts'
import { notesFor, visibleSections, type SettingsGroup, type SettingsSectionId } from './settings-sections.ts'

type SettingsPageProps = {
  installed: InstalledCapability[]
  onNotice: (message: string) => void
  onNavigate: (view: View) => void
  providerStatus: ProviderStatus | null
  onSelectProvider: (kind: ProviderKind) => Promise<void>
  onCheckProvider: () => Promise<ProviderStatus>
  onRefreshProvider: () => void
}

export function SettingsPage({ installed, onNotice, onNavigate, providerStatus, onSelectProvider, onCheckProvider, onRefreshProvider }: SettingsPageProps) {
  const { t } = useTranslation()
  const { theme, setTheme, language, setLanguage, providerKind } = useWorkbench()
  const [checking, setChecking] = useState(false)
  const [testingProvider, setTestingProvider] = useState(false)
  const desktop = isDesktopHost()

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

  // One renderer per section id, so the grouping stays data and the layout stays markup.
  const body: Partial<Record<SettingsSectionId, ReactNode>> = {
    'skills': (
      <div className="settings-linked-row">
        <button className="quiet-button" onClick={() => onNavigate('skills')}>{t('sectionSkillsOpen')}<ArrowRightIcon /></button>
      </div>
    ),
    'model-access': (
      <>
        <div className="provider-options">
          {(['codex-api', 'codex-subscription', 'compatible-api'] as ProviderKind[]).map((kind) => (
            <button key={kind} className={`provider-option ${providerKind === kind ? 'selected' : ''}`} onClick={() => void onSelectProvider(kind)}>
              <span className="provider-option-icon">{kind === 'compatible-api' ? <GlobeIcon /> : kind === 'codex-api' ? <LightningBoltIcon /> : <CodeIcon />}</span>
              <span><strong>{providerLabel(t, kind)}</strong><small>{kind === 'codex-api' ? t('apiDescription') : kind === 'codex-subscription' ? t('subscriptionDescription') : t('compatibleDescription')}</small></span>
              {providerKind === kind && <CheckIcon className="selected-check" />}
            </button>
          ))}
        </div>
        <ScopeNotes section="model-access" />
        <div className="provider-detail">
          <div className="detail-icon"><UpdateIcon /></div>
          <div><strong>{providerStatus?.label ?? providerLabel(t, providerKind)} · {providerStateLabel(t, providerStatus?.state)}</strong><span>{providerStatus?.detail ?? t('providerStatusLoading')}</span></div>
          <div className="provider-detail-actions">
            <button className="quiet-button" onClick={runCheck} disabled={checking}>{checking ? t('checkingEllipsis') : t('healthCheck')}<ReloadIcon className={checking ? 'spin' : ''} /></button>
            <button className="quiet-button" onClick={testProvider} disabled={testingProvider}>{testingProvider ? t('testingEllipsis') : t('testCall')}<ArrowRightIcon /></button>
          </div>
        </div>
        {providerKind === 'compatible-api' && <CompatibleEndpointSettings language={language} onNotice={onNotice} onChanged={onRefreshProvider} />}
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
