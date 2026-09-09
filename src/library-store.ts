import type { DocumentPublication } from '../packages/capability-contract/src/index.ts'

export type LibraryDocumentMetadata = Omit<DocumentPublication, 'content'> & {
  id: string; capabilityId: string; capabilityName: string; format: 'markdown'; sizeBytes: number
  createdAt: string; updatedAt: string; revision?: string; section?: LibrarySection
}
export type LibraryDocument = LibraryDocumentMetadata & { content: string }
export type LibrarySection = { id: string; name: string }
export type Topic = { id: string; name: string; documentIds: string[] }
export type Origin = { threadId: string; messageId: string }
export type Organization = { topics: Topic[]; trash: Record<string, string>; origins: Record<string, Origin>; sections?: Record<string, LibrarySection> }
export type LibraryChange =
  | { kind: 'import'; document: DocumentPublication }
  | { kind: 'edit'; id: string; title: string; content: string; expected: string }
  | { kind: 'restore-version'; id: string; revision: string; expected: string }
  | { kind: 'save-topic'; topic: Topic }
  | { kind: 'delete-topic'; id: string }
  | { kind: 'trash' | 'restore' | 'purge'; ids: string[] }
  | { kind: 'place'; id: string; topicId?: string; section: LibrarySection }
  | { kind: 'origin'; id: string; origin: Origin }
type LibraryState = { documents: LibraryDocument[]; history: Record<string, LibraryDocument[]>; organization: Organization }
export const libraryStorageKey = 'personal-workbench-library-v2'
export const emptyOrganization = (): Organization => ({ topics: [], trash: {}, origins: {} })

export function createLibraryStore(storage: Pick<Storage, 'getItem' | 'setItem'>) {
  const load = (): LibraryState => {
    const saved = storage.getItem(libraryStorageKey)
    if (saved) return JSON.parse(saved)
    const documents: LibraryDocument[] = JSON.parse(storage.getItem('personal-workbench-document-library') ?? '[]')
    return { documents: documents.map((doc) => ({ ...doc, revision: doc.revision ?? doc.updatedAt })), history: {}, organization: emptyOrganization() }
  }
  const find = (state: LibraryState, id: string) => {
    const doc = state.documents.find((doc) => doc.id === id)
    if (!doc) throw new Error('文档不存在 / Document not found')
    return doc
  }
  const publish = (state: LibraryState, source: string, name: string, input: DocumentPublication) => {
    if (!input.title.trim() || new TextEncoder().encode(input.title).length > 240 || !input.content.trim() || new TextEncoder().encode(input.content).length > 2_000_000
      || !/^[a-z0-9-]{1,100}$/.test(input.key) || !/^[a-z0-9-]{1,100}$/.test(input.collectionKey)
      || !/^\d{4}-\d{2}-\d{2}$/.test(input.documentDate) || !Number.isFinite(Date.parse(input.documentDate)) || new Date(input.documentDate).toISOString().slice(0, 10) !== input.documentDate) throw new Error('标题、日期或正文无效 / Invalid title, date or content')
    const id = `${source}/${input.collectionKey}/${input.documentDate.slice(0, 4)}/${input.documentDate.slice(5, 7)}/${input.key}`
    if (state.organization.trash[id]) throw new Error('请先从回收站恢复文档 / Restore this document from Trash first')
    const previous = state.documents.find((doc) => doc.id === id)
    if (previous) (state.history[id] ??= []).push(previous)
    const now = new Date().toISOString()
    const doc: LibraryDocument = { ...input, id, capabilityId: source, capabilityName: name, format: 'markdown', sizeBytes: new TextEncoder().encode(input.content).length, createdAt: previous?.createdAt ?? now, updatedAt: now, revision: crypto.randomUUID() }
    state.documents = [...state.documents.filter((item) => item.id !== id), doc]
    return doc
  }
  return {
    list(trash = false) { const state = load(); return state.documents.filter((d) => Boolean(state.organization.trash[d.id]) === trash).sort((a, b) => b.documentDate.localeCompare(a.documentDate)) },
    read(id: string) { const state = load(); if (state.organization.trash[id]) throw new Error('文档在回收站中 / Document is in Trash'); return find(state, id) },
    organization: () => load().organization,
    history(id: string) { const state = load(); return [find(state, id), ...(state.history[id] ?? []).slice().reverse()] },
    publish(source: string, name: string, input: DocumentPublication) { const state = load(); const doc = publish(state, source, name, input); storage.setItem(libraryStorageKey, JSON.stringify(state)); return doc },
    change(change: LibraryChange): LibraryDocumentMetadata | null {
      const state = load()
      let result: LibraryDocumentMetadata | null = null
      switch (change.kind) {
        case 'import': result = publish(state, 'workbench.imports', '导入 / Imports', { ...change.document, collectionKey: 'imports', collectionName: '导入资料 / Imported documents' }); break
        case 'edit': case 'restore-version': {
          const current = find(state, change.id)
          if (current.revision !== change.expected) throw new Error('文档已更新，请重新打开后修改 / Document changed. Reopen it before editing.')
          const value = change.kind === 'edit' ? change : (state.history[change.id] ?? []).find((doc) => doc.revision === change.revision)
          if (!value) throw new Error('Version not found')
          result = publish(state, current.capabilityId, current.capabilityName, { ...current, title: value.title, content: value.content })
          break
        }
        case 'save-topic': {
          if (!change.topic.name.trim() || [...change.topic.name].length > 80) throw new Error('专题名称无效 / Invalid topic name')
          change.topic.documentIds.forEach((id) => find(state, id))
          state.organization.topics = [...state.organization.topics.filter((t) => t.id !== change.topic.id), { ...change.topic, name: change.topic.name.trim(), documentIds: [...new Set(change.topic.documentIds)] }]; break
        }
        case 'delete-topic': state.organization.topics = state.organization.topics.filter((t) => t.id !== change.id); break
        case 'trash': change.ids.forEach((id) => find(state, id)); change.ids.forEach((id) => { state.organization.trash[id] = new Date().toISOString() }); break
        case 'restore': change.ids.forEach((id) => { delete state.organization.trash[id] }); break
        case 'purge':
          if (change.ids.some((id) => !state.organization.trash[id])) throw new Error('Only documents in Trash can be deleted permanently')
          state.documents = state.documents.filter((d) => !change.ids.includes(d.id))
          change.ids.forEach((id) => { delete state.history[id]; delete state.organization.trash[id]; delete state.organization.origins[id]; delete state.organization.sections?.[id] })
          state.organization.topics.forEach((t) => { t.documentIds = t.documentIds.filter((id) => !change.ids.includes(id)) }); break
        case 'place': {
          find(state, change.id)
          if (state.organization.trash[change.id]) throw new Error('文档在回收站中 / Document is in Trash')
          if (!change.section.id.trim() || change.section.id.length > 200 || !change.section.name.trim() || [...change.section.name].length > 80) throw new Error('栏目无效 / Invalid section')
          const topic = state.organization.topics.find((topic) => topic.id === change.topicId)
          if (change.topicId && !topic) throw new Error('专题已不存在，请重新选择 / Topic no longer exists')
          if (topic && !topic.documentIds.includes(change.id)) topic.documentIds.push(change.id)
          ;(state.organization.sections ??= {})[change.id] = { ...change.section, name: change.section.name.trim() }
          break
        }
        case 'origin': find(state, change.id); state.organization.origins[change.id] = change.origin; break
      }
      storage.setItem(libraryStorageKey, JSON.stringify(state))
      return result
    },
  }
}
