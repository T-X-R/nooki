import { FileTextIcon, MagicWandIcon, Pencil2Icon } from '@radix-ui/react-icons'
import type { CapabilityManifest } from '../../platform/capability-host.ts'
import type { Language } from '../../shared/i18n.ts'

export function capabilityCopy(capability: { manifest: CapabilityManifest }, language: Language) {
  const translation = capability.manifest.locales?.[language]
  return {
    name: translation?.name || capability.manifest.name,
    description: translation?.description ?? capability.manifest.description,
  }
}

export function CapabilityIcon({ name }: { name?: string }) {
  if (name === 'pencil-2') return <Pencil2Icon />
  if (name === 'magic-wand') return <MagicWandIcon />
  return <FileTextIcon />
}
