import { useTranslation } from 'react-i18next'
import { ArrowRightIcon, ChevronRightIcon, LightningBoltIcon, PlusIcon } from '@radix-ui/react-icons'
import type { DocumentReference } from '../../../packages/capability-contract/src/index.ts'
import type { InstalledCapability } from '../../platform/capability-host.ts'
import type { ProviderStatus } from '../../platform/ai-provider.ts'
import { capabilityCopy } from '../capabilities/capability-presentation.tsx'
import { providerLabel, providerStateLabel } from '../settings/provider-labels.ts'
import { useWorkbench, type View } from '../../platform/preferences.ts'
import { TodayActivity } from './TodayActivity.tsx'

export function TodayPage({ installed, onNavigate, onOpenCapability, onDocument, onTask, providerStatus }: { installed: InstalledCapability[]; onNavigate: (view: View) => void; onOpenCapability: (id: string) => void; onDocument: (reference: DocumentReference) => void; onTask: (id: string) => void; providerStatus: ProviderStatus | null }) {
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
