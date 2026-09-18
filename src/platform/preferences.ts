import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ProviderKind } from './ai-provider.ts'
import type { Language } from '../shared/i18n.ts'

export type View = 'today' | 'library' | 'skills' | 'capabilities' | 'settings' | 'capability' | 'tasks' | 'conversations'
export type Theme = 'light' | 'dark'

export type WorkbenchState = {
  view: View
  theme: Theme
  language: Language
  providerKind: ProviderKind
  setView: (view: View) => void
  setTheme: (theme: Theme) => void
  setLanguage: (language: Language) => void
  setProviderKind: (providerKind: ProviderKind) => void
}

export const useWorkbench = create<WorkbenchState>()(
  persist(
    (set) => ({
      view: 'today',
      theme: 'light',
      language: 'zh',
      providerKind: 'codex-api',
      setView: (view) => set({ view }),
      setTheme: (theme) => set({ theme }),
      setLanguage: (language) => set({ language }),
      setProviderKind: (providerKind) => set({ providerKind }),
    }),
    {
      name: 'personal-workbench-preferences',
      version: 3,
      migrate: (persistedState) => {
        const state = persistedState as Partial<WorkbenchState>
        const previousKind = state.providerKind as string | undefined
        const providerKind: ProviderKind = previousKind === 'codex-cli'
          ? 'codex-subscription'
          : previousKind === 'openai-api'
            ? 'codex-api'
            : previousKind === 'codex-subscription' || previousKind === 'compatible-api'
              ? previousKind
              : 'codex-api'
        const language: Language = state.language === 'en' ? 'en' : 'zh'
        return { ...state, providerKind, language }
      },
    },
  ),
)
