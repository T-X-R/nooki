import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Language } from '../shared/i18n.ts'

export type View = 'today' | 'library' | 'skills' | 'capabilities' | 'settings' | 'capability' | 'tasks' | 'conversations'
export type Theme = 'light' | 'dark'

const SUBSTRATE_NOTICE = 'nooki-agent-substrate-notice'

/** True exactly once, for somebody whose settings still named a Provider Nooki used to call. */
export function takeSubstrateNotice(): boolean {
  if (window.localStorage.getItem(SUBSTRATE_NOTICE) !== 'pending') return false
  window.localStorage.removeItem(SUBSTRATE_NOTICE)
  return true
}

/**
 * What Nooki remembers about how it looks to one person. Which agent serves Capabilities is not
 * here: it is a fact about this machine, so the desktop host keeps it where every window agrees.
 */
export type WorkbenchState = {
  view: View
  theme: Theme
  language: Language
  setView: (view: View) => void
  setTheme: (theme: Theme) => void
  setLanguage: (language: Language) => void
}

export const useWorkbench = create<WorkbenchState>()(
  persist(
    (set) => ({
      view: 'today',
      theme: 'light',
      language: 'zh',
      setView: (view) => set({ view }),
      setTheme: (theme) => set({ theme }),
      setLanguage: (language) => set({ language }),
    }),
    {
      name: 'personal-workbench-preferences',
      version: 4,
      migrate: (persistedState) => {
        // `providerKind` chose between Nooki's own endpoint and two ways of reaching Codex. Nooki no
        // longer calls a model service, so the choice is dropped here and made again by the host.
        const { providerKind, ...state } = persistedState as Partial<WorkbenchState> & { providerKind?: unknown }
        // Somebody who had made that choice deserves to be told it is gone, once.
        if (providerKind) window.localStorage.setItem(SUBSTRATE_NOTICE, 'pending')
        const language: Language = state.language === 'en' ? 'en' : 'zh'
        return { ...state, language }
      },
    },
  ),
)
