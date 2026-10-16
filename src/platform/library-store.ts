import { folderDestination, migrateLibraryFolders, validateFolder } from './library-folders.ts'
import type { DocumentPublication } from '../../packages/capability-contract/src/index.ts'

export type LibraryDocumentMetadata = Omit<DocumentPublication, 'content'> & {
  id: string; capabilityId: string; capabilityName: string; format: 'markdown'; sizeBytes: number
  createdAt: string; updatedAt: string; revision?: string; section?: LibrarySection
}
export type LibraryDocument = LibraryDocumentMetadata & { content: string }
export type LibrarySection = { id: string; name: string; topicId?: string }
export type LibraryFolder = { id: string; name: string; parentId?: string; documentIds: string[] }
export type Topic = { id: string; name: string; documentIds: string[] }
export type Origin = { threadId: string; messageId: string }
export type Organization = { folders?: LibraryFolder[]; topics: Topic[]; trash: Record<string, string>; origins: Record<string, Origin>; sections?: Record<string, LibrarySection>; customSections?: LibrarySection[] }
export type LibraryChange =
  | { kind: 'import'; document: DocumentPublication; folderId?: string }
  | { kind: 'create'; document: DocumentPublication; folderId?: string; topicId?: string; section?: LibrarySection }
  | { kind: 'save-folder'; folder: LibraryFolder }
  | { kind: 'delete-folder'; id: string }
  | { kind: 'move-documents'; ids: string[]; folderId?: string }
  | { kind: 'edit'; id: string; title: string; content: string; expected: string }
  | { kind: 'restore-version'; id: string; revision: string; expected: string }
  | { kind: 'save-topic'; topic: Topic }
  | { kind: 'delete-topic'; id: string }
  | { kind: 'create-section'; section: LibrarySection }
  | { kind: 'rename-section'; id: string; name: string }
  | { kind: 'delete-section'; id: string }
  | { kind: 'delete-documents'; ids: string[] }
  | { kind: 'place'; id: string; topicId?: string; section: LibrarySection }
  | { kind: 'origin'; id: string; origin: Origin }
type LibraryState = { documents: LibraryDocument[]; history: Record<string, LibraryDocument[]>; organization: Organization }
export const libraryStorageKey = 'personal-workbench-library-v2'
export const emptyOrganization = (): Organization => ({ topics: [], trash: {}, origins: {} })

function deleteDocumentRecords(state: LibraryState, ids: Set<string>) {
  state.documents = state.documents.filter(doc => !ids.has(doc.id))
  ids.forEach(id => { delete state.history[id]; delete state.organization.trash[id]; delete state.organization.origins[id]; delete state.organization.sections?.[id] })
  state.organization.folders!.forEach(folder => { folder.documentIds = folder.documentIds.filter(id => !ids.has(id)) })
  state.organization.topics.forEach(topic => { topic.documentIds = topic.documentIds.filter(id => !ids.has(id)) })
}

export function createLibraryStore(storage: Pick<Storage, 'getItem' | 'setItem'>) {
  const load = (): LibraryState => {
    const saved = storage.getItem(libraryStorageKey)
    if (saved) {
      const state: LibraryState = JSON.parse(saved)
      state.organization.folders = migrateLibraryFolders(state.organization)
      Object.keys(state.history).forEach(id => { state.history[id] = state.history[id].slice(-9) })
      const deleted = new Set(Object.keys(state.organization.trash))
      if (deleted.size) { deleteDocumentRecords(state, deleted); storage.setItem(libraryStorageKey, JSON.stringify(state)) }
      return state
    }
    const documents: LibraryDocument[] = JSON.parse(storage.getItem('personal-workbench-document-library') ?? '[]')
    return { documents: documents.map((doc) => ({ ...doc, revision: doc.revision ?? doc.updatedAt })), history: {}, organization: { ...emptyOrganization(), folders: [] } }
  }
  const find = (state: LibraryState, id: string) => {
    const doc = state.documents.find((doc) => doc.id === id)
    if (!doc) throw new Error('文档不存在 / Document not found')
    return doc
  }
  const destination = (state: LibraryState, requestedTopicId: string | undefined, requestedSection: LibrarySection) => {
    if (!requestedSection.id.trim() || requestedSection.id.length > 200 || !requestedSection.name.trim() || [...requestedSection.name].length > 80) throw new Error('栏目无效 / Invalid section')
    const section = requestedSection.id.startsWith('custom-') ? state.organization.customSections?.find((section) => section.id === requestedSection.id) : requestedSection
    if (!section) throw new Error('栏目已不存在，请重新选择 / Section no longer exists')
    if (section.topicId && requestedTopicId && section.topicId !== requestedTopicId) throw new Error('栏目属于其他专题 / Section belongs to a different topic')
    const topicId = requestedTopicId || section.topicId
    const topic = state.organization.topics.find((topic) => topic.id === topicId)
    if (topicId && !topic) throw new Error('专题已不存在，请重新选择 / Topic no longer exists')
    return { section: { ...section, name: section.name.trim() }, topic }
  }
  const publish = (state: LibraryState, source: string, name: string, input: DocumentPublication, allowEmpty = false) => {
    if (!input.title.trim() || new TextEncoder().encode(input.title).length > 240 || (!allowEmpty && !input.content.trim()) || new TextEncoder().encode(input.content).length > 2_000_000
      || !/^[a-z0-9-]{1,100}$/.test(input.key) || !/^[a-z0-9-]{1,100}$/.test(input.collectionKey)
      || !/^\d{4}-\d{2}-\d{2}$/.test(input.documentDate) || !Number.isFinite(Date.parse(input.documentDate)) || new Date(input.documentDate).toISOString().slice(0, 10) !== input.documentDate) throw new Error('标题、日期或正文无效 / Invalid title, date or content')
    const id = `${source}/${input.collectionKey}/${input.documentDate.slice(0, 4)}/${input.documentDate.slice(5, 7)}/${input.key}`
    const previous = state.documents.find((doc) => doc.id === id)
    if (previous) state.history[id] = [...state.history[id] ?? [], previous].slice(-9)
    const now = new Date().toISOString()
    const doc: LibraryDocument = { ...input, id, capabilityId: source, capabilityName: name, format: 'markdown', sizeBytes: new TextEncoder().encode(input.content).length, createdAt: previous?.createdAt ?? now, updatedAt: now, revision: crypto.randomUUID() }
    state.documents = [...state.documents.filter((item) => item.id !== id), doc]
    return doc
  }
  return {
    list() { const state = load(); return state.documents.sort((a, b) => b.documentDate.localeCompare(a.documentDate)) },
    read(id: string) { return find(load(), id) },
    organization: () => load().organization,
    history(id: string) { const state = load(); return [find(state, id), ...(state.history[id] ?? []).slice().reverse()] },
    publish(source: string, name: string, input: DocumentPublication) { const state = load(); const doc = publish(state, source, name, input); storage.setItem(libraryStorageKey, JSON.stringify(state)); return doc },
    change(change: LibraryChange): LibraryDocumentMetadata | null {
      const state = load()
      let result: LibraryDocumentMetadata | null = null
      switch (change.kind) {
        case 'create': {
          const folder = folderDestination(state.organization.folders!, change.folderId)
          const { topic, section } = destination(state, change.topicId, change.section ?? { id: 'workbench.documents', name: '我的文档 / My documents' })
          result = publish(state, 'workbench.documents', '我的文档 / My documents', { ...change.document, collectionKey: 'documents', collectionName: '我的文档 / My documents' }, true)
          if (topic && !topic.documentIds.includes(result.id)) topic.documentIds.push(result.id)
          if (change.section) (state.organization.sections ??= {})[result.id] = section
          if (folder && !folder.documentIds.includes(result.id)) folder.documentIds.push(result.id)
          break
        }
        case 'import': {
          const folder = folderDestination(state.organization.folders!, change.folderId)
          result = publish(state, 'workbench.imports', '导入 / Imports', { ...change.document, collectionKey: 'imports', collectionName: '导入资料 / Imported documents' })
          if (folder && !folder.documentIds.includes(result.id)) folder.documentIds.push(result.id)
          break
        }
        case 'save-folder': {
          const folders = state.organization.folders!
          const folder = { ...change.folder, name: change.folder.name.trim(), parentId: change.folder.parentId || undefined }
          validateFolder(folders, folder)
          const existing = folders.find(item => item.id === folder.id)
          if (existing) { existing.name = folder.name; existing.parentId = folder.parentId }
          else folders.push({ ...folder, documentIds: [] })
          break
        }
        case 'move-documents': {
          const folder = folderDestination(state.organization.folders!, change.folderId)
          change.ids.forEach(id => find(state, id))
          state.organization.folders!.forEach(folder => { folder.documentIds = folder.documentIds.filter(id => !change.ids.includes(id)) })
          if (folder) folder.documentIds.push(...new Set(change.ids))
          break
        }
        case 'delete-folder': {
          const folders = state.organization.folders!
          const folder = folderDestination(folders, change.id)
          if (!folder) throw new Error('文件夹已不存在 / Folder not found')
          const removed = new Set([folder.id])
          for (const id of removed) for (const item of folders) if (item.parentId === id) removed.add(item.id)
          const ids = new Set(folders.filter(item => removed.has(item.id)).flatMap(item => item.documentIds))
          ids.forEach(id => find(state, id))
          deleteDocumentRecords(state, ids)
          state.organization.folders = folders.filter(item => !removed.has(item.id))
          break
        }
        case 'edit': case 'restore-version': {
          const current = find(state, change.id)
          if (current.revision !== change.expected) throw new Error('文档已更新，请重新打开后修改 / Document changed. Reopen it before editing.')
          const value = change.kind === 'edit' ? change : (state.history[change.id] ?? []).find((doc) => doc.revision === change.revision)
          if (!value) throw new Error('Version not found')
          result = publish(state, current.capabilityId, current.capabilityName, { ...current, title: value.title, content: value.content }, true)
          break
        }
        case 'save-topic': {
          if (!change.topic.name.trim() || [...change.topic.name].length > 80) throw new Error('专题名称无效 / Invalid topic name')
          change.topic.documentIds.forEach((id) => find(state, id))
          const topic = { ...change.topic, name: change.topic.name.trim(), documentIds: [...new Set(change.topic.documentIds)] }
          const index = state.organization.topics.findIndex((item) => item.id === topic.id)
          if (index < 0) state.organization.topics.push(topic); else state.organization.topics[index] = topic
          break
        }
        case 'create-section': {
          const section = { ...change.section, name: change.section.name.trim() }
          if (!section.topicId) delete section.topicId
          if (section.topicId && !state.organization.topics.some((topic) => topic.id === section.topicId)) throw new Error('专题已不存在，请重新选择 / Topic no longer exists')
          if (!/^custom-[a-z0-9-]{1,100}$/.test(section.id) || !section.name || [...section.name].length > 80) throw new Error('栏目名称无效 / Invalid section name')
          const sections = state.organization.customSections ??= []
          if (sections.some((item) => item.id === section.id || (item.topicId === section.topicId && item.name.toLocaleLowerCase() === section.name.toLocaleLowerCase()))) throw new Error('栏目已存在 / Section already exists')
          sections.push(section); break
        }
        case 'rename-section': {
          const section = state.organization.customSections?.find((section) => section.id === change.id)
          if (!section) throw new Error('栏目已不存在，请重新选择 / Section no longer exists')
          const name = change.name.trim()
          if (!name || [...name].length > 80) throw new Error('栏目名称无效 / Invalid section name')
          if (state.organization.customSections?.some((item) => item.id !== change.id && item.topicId === section.topicId && item.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error('栏目已存在 / Section already exists')
          section.name = name
          Object.values(state.organization.sections ?? {}).forEach((item) => { if (item.id === change.id) item.name = name })
          break
        }
        case 'delete-section': {
          if (!state.organization.customSections?.some((section) => section.id === change.id)) throw new Error('栏目已不存在，请重新选择 / Section no longer exists')
          state.organization.customSections = state.organization.customSections.filter((section) => section.id !== change.id)
          Object.entries(state.organization.sections ?? {}).forEach(([id, section]) => { if (section.id === change.id) delete state.organization.sections![id] })
          break
        }
        case 'delete-topic':
          state.organization.topics = state.organization.topics.filter((t) => t.id !== change.id)
          for (const section of [...state.organization.customSections ?? [], ...Object.values(state.organization.sections ?? {})]) { if (section.topicId === change.id) delete section.topicId }
          break
        case 'delete-documents':
          change.ids.forEach(id => find(state, id))
          deleteDocumentRecords(state, new Set(change.ids)); break
        case 'place': {
          find(state, change.id)
          const { topic, section } = destination(state, change.topicId, change.section)
          if (topic && !topic.documentIds.includes(change.id)) topic.documentIds.push(change.id)
          ;(state.organization.sections ??= {})[change.id] = section
          break
        }
        case 'origin': find(state, change.id); state.organization.origins[change.id] = change.origin; break
        default: throw new Error('Unsupported Library operation')
      }
      storage.setItem(libraryStorageKey, JSON.stringify(state))
      return result
    },
  }
}
