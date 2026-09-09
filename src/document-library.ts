import { invoke } from '@tauri-apps/api/core'
import type { DocumentPublication } from '../packages/capability-contract/src'
import { createLibraryStore, type LibraryChange, type Organization, type LibraryDocument, type LibraryDocumentMetadata } from './library-store'
export type { LibraryDocument, LibraryDocumentMetadata, Topic, Origin, Organization, LibraryChange, LibrarySection } from './library-store'

const browser = () => createLibraryStore(window.localStorage)
const changed = () => window.dispatchEvent(new Event('workbench:library-changed'))
export async function publishCapabilityDocument(capabilityId: string, capabilityName: string, document: DocumentPublication): Promise<void> {
  if (window.__TAURI_INTERNALS__) await invoke('capability_documents_publish', { request: { capabilityId, document } })
  else browser().publish(capabilityId, capabilityName, document)
  changed()
}
export async function listLibraryDocuments(): Promise<LibraryDocumentMetadata[]> {
  const [documents, organization] = await Promise.all([
    window.__TAURI_INTERNALS__ ? invoke<LibraryDocumentMetadata[]>('library_list_documents') : browser().list().map(({ content: _content, ...doc }) => doc),
    libraryOrganization(),
  ])
  return documents.map((doc) => ({ ...doc, section: organization.sections?.[doc.id] }))
}
export async function readLibraryDocument(id: string): Promise<LibraryDocument> {
  return window.__TAURI_INTERNALS__ ? invoke('library_read_document', { id }) : browser().read(id)
}
export async function searchLibraryContent(query: string): Promise<string[]> {
  if (!query.trim()) return []
  return window.__TAURI_INTERNALS__ ? invoke('library_search_content', { query }) : browser().list().filter((doc) => doc.content.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).map((doc) => doc.id)
}
export async function libraryOrganization(): Promise<Organization> {
  return window.__TAURI_INTERNALS__ ? invoke('library_organization') : browser().organization()
}
export async function changeLibrary(change: LibraryChange): Promise<LibraryDocumentMetadata | null> {
  const result = window.__TAURI_INTERNALS__ ? await invoke<LibraryDocumentMetadata | null>('library_change', { change }) : browser().change(change)
  changed()
  return result
}
export async function libraryHistory(id: string): Promise<LibraryDocument[]> {
  return window.__TAURI_INTERNALS__ ? invoke('library_history', { id }) : browser().history(id)
}
export async function libraryTrash(): Promise<LibraryDocumentMetadata[]> {
  return window.__TAURI_INTERNALS__ ? invoke('library_trash') : browser().list(true).map(({ content: _content, ...doc }) => doc)
}
