import { AnimatePresence } from 'motion/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowRightIcon, CodeIcon, PlusIcon } from '@radix-ui/react-icons'
import type { InstalledCapability } from '../../platform/capability-host.ts'
import { getCapabilityLoadError, installCapabilityPackage, listAvailableCapabilities, rollbackCapabilityPackage, setCapabilityPackageEnabled, uninstallCapabilityPackage } from '../../platform/capability-runtime.ts'
import { useWorkbench } from '../../platform/preferences.ts'
import { CapabilityIcon, capabilityCopy } from './capability-presentation.tsx'
import { DeveloperCenterModal } from './DeveloperCenterModal.tsx'
import { PackageImportModal } from './PackageImportModal.tsx'

type CapabilityFilter = 'all' | 'enabled' | 'disabled'

export function CapabilitiesPage({ installed, onRefresh, onOpenCapability, onNotice }: { installed: InstalledCapability[]; onRefresh: () => Promise<void>; onOpenCapability: (id: string) => void; onNotice: (message: string) => void }) {
  const { t } = useTranslation()
  const { language } = useWorkbench()
  const [importOpen, setImportOpen] = useState(false)
  const [integrationOpen, setIntegrationOpen] = useState(false)
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
        <div><h1 className="capabilities-intro-title"><span>{t('capabilitiesHeadline')}</span><span>{t('capabilitiesHeadlineEnding')}</span></h1><p>{t('capabilitiesIntro')}</p></div>
        <button className="primary-button" onClick={() => setImportOpen(true)}><PlusIcon />{t('importCapability')}</button>
      </div>

      <div className="capability-toolbar">
        <div className="capability-filters" role="group" aria-label={t('filterCapabilities')}>
          {filters.map((option) => <button key={option.id} className={`filter-chip ${filter === option.id ? 'active' : ''}`} aria-pressed={filter === option.id} onClick={() => setFilter(option.id)}>{option.label} <span>{option.count}</span></button>)}
        </div>
        <div className="toolbar-spacer" />
        <button className="quiet-button developer-center-trigger" onClick={() => setIntegrationOpen(true)}><CodeIcon />{t('developerCenter')}</button>
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
        {integrationOpen && <DeveloperCenterModal language={language} onClose={() => setIntegrationOpen(false)} />}
        {importOpen && <PackageImportModal language={language} onClose={() => setImportOpen(false)} onInstalled={async () => { await onRefresh(); onNotice(t('capabilityInstalled')) }} />}
      </AnimatePresence>
    </div>
  )
}
