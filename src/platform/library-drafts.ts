import type { LibraryDocument } from './library-store.ts'

export const libraryDraftKey = 'personal-workbench-library-drafts-v1'
export type LibraryDraft = { title: string; content: string; revision: string }
export function createLibraryDrafts(storage: Pick<Storage, 'getItem' | 'setItem'>) {
  const read = (): Record<string, LibraryDraft> => JSON.parse(storage.getItem(libraryDraftKey) ?? '{}')
  return {
    get(document: LibraryDocument) {
      const draft = read()[document.id]
      return draft && typeof draft.title === 'string' && typeof draft.content === 'string' && typeof draft.revision === 'string' && (draft.title !== document.title || draft.content !== document.content) ? draft : null
    },
    save(id: string, draft: LibraryDraft) { storage.setItem(libraryDraftKey, JSON.stringify({ ...read(), [id]: draft })) },
    remove(id: string) { const drafts = read(); delete drafts[id]; storage.setItem(libraryDraftKey, JSON.stringify(drafts)) },
  }
}
