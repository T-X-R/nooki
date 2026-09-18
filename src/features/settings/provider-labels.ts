import type { TFunction } from 'i18next'
import type { ProviderKind, ProviderStatus } from '../../platform/ai-provider.ts'

export function providerLabel(t: TFunction, kind: ProviderKind) {
  return kind === 'codex-api' ? t('providerApi') : kind === 'codex-subscription' ? t('providerSubscription') : t('providerCompatible')
}

export function providerStateLabel(t: TFunction, state: ProviderStatus['state'] | undefined) {
  return state === 'ready' ? t('connected') : state === 'configured' ? t('configured') : state === 'error' ? t('needsAttention') : t('checking')
}
