import { Component, useEffect, useState, type ReactNode } from 'react'
import { createCapabilityHost, releaseCapabilityHost, type CapabilityHost } from '../../platform/capability-host.ts'
import type { CapabilityModule } from '../../platform/capability-runtime.ts'
import type { Language } from '../../shared/i18n.ts'

export class CapabilityErrorBoundary extends Component<{ children: ReactNode; onBack(): void; language: Language }, { error: string | null }> {
  state = { error: null as string | null }
  static getDerivedStateFromError(error: Error) { return { error: error.message } }
  render() {
    return this.state.error ? <div className="content-column" role="alert"><h2>{this.props.language === 'zh' ? '能力页面加载失败' : 'Capability page failed'}</h2><p>{this.state.error}</p><button className="primary-button" onClick={this.props.onBack}>{this.props.language === 'zh' ? '管理能力或回退版本' : 'Manage capability or roll back'}</button></div> : this.props.children
  }
}

export function CapabilityPage({ module }: { module: CapabilityModule }) {
  const Page = module.Page
  const [scope, setScope] = useState<{ module: CapabilityModule; host: CapabilityHost }>()
  useEffect(() => {
    const host = createCapabilityHost(module.manifest.id, module.manifest.permissions, module.manifest.name)
    setScope({ module, host })
    return () => { void releaseCapabilityHost(host).catch(() => console.warn('Capability board invocation release failed')) }
  }, [module])
  return scope?.module === module ? <Page host={scope.host} /> : null
}
