import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowRightIcon, CheckIcon, CodeIcon, GlobeIcon, LightningBoltIcon, MoonIcon, ReloadIcon, SunIcon, UpdateIcon } from '@radix-ui/react-icons'
import type { InstalledCapability } from '../../platform/capability-host.ts'
import { testSelectedProvider, type ProviderKind, type ProviderStatus } from '../../platform/ai-provider.ts'
import { ConversationArchives } from '../conversation/ConversationArchives.tsx'
import { useWorkbench } from '../../platform/preferences.ts'
import { CompatibleEndpointSettings } from './CompatibleEndpointSettings.tsx'
import { DataManagement } from './DataManagement.tsx'
import { providerLabel, providerStateLabel } from './provider-labels.ts'

export function SettingsPage({ onOpenConversation, installed, onNotice, providerStatus, onSelectProvider, onCheckProvider, onRefreshProvider }: { onOpenConversation(id: string): void; installed: InstalledCapability[]; onNotice: (message: string) => void; providerStatus: ProviderStatus | null; onSelectProvider: (kind: ProviderKind) => Promise<void>; onCheckProvider: () => Promise<ProviderStatus>; onRefreshProvider: () => void }) {
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
        {providerKind === 'compatible-api' && <CompatibleEndpointSettings language={language} onNotice={onNotice} onChanged={onRefreshProvider} />}
      </section>

      <section className="settings-section"><div className="settings-section-heading"><span className="settings-number">02</span><div><h2>{t('appearance')}</h2><p>{t('appearanceIntro')}</p></div></div><div className="theme-options"><button className={`theme-option ${theme === 'light' ? 'selected' : ''}`} onClick={() => setTheme('light')}><span className="theme-preview theme-preview-light"><SunIcon /></span><span><strong>{t('light')}</strong><small>{t('lightDescription')}</small></span>{theme === 'light' && <CheckIcon className="selected-check" />}</button><button className={`theme-option ${theme === 'dark' ? 'selected' : ''}`} onClick={() => setTheme('dark')}><span className="theme-preview theme-preview-dark"><MoonIcon /></span><span><strong>{t('dark')}</strong><small>{t('darkDescription')}</small></span>{theme === 'dark' && <CheckIcon className="selected-check" />}</button></div></section>

      <section className="settings-section"><div className="settings-section-heading"><span className="settings-number">03</span><div><h2>{t('language')}</h2><p>{t('languageIntro')}</p></div></div><div className="theme-options language-options"><button className={`theme-option ${language === 'zh' ? 'selected' : ''}`} onClick={() => setLanguage('zh')}><span className="language-preview">中</span><span><strong>{t('chinese')}</strong><small>{t('chineseDescription')}</small></span>{language === 'zh' && <CheckIcon className="selected-check" />}</button><button className={`theme-option ${language === 'en' ? 'selected' : ''}`} onClick={() => setLanguage('en')}><span className="language-preview">EN</span><span><strong>{t('english')}</strong><small>{t('englishDescription')}</small></span>{language === 'en' && <CheckIcon className="selected-check" />}</button></div></section>

      <section className="settings-section"><div className="settings-section-heading"><span className="settings-number">04</span><div><h2>{t('localData')}</h2><p>{t('localDataIntro')}</p></div></div><DataManagement language={language} installed={installed} /></section>
      <ConversationArchives language={language} onRestore={onOpenConversation} />
    </div>
  )
}
