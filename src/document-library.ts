import { invoke } from '@tauri-apps/api/core'
import type { DocumentPublication } from '../packages/capability-contract/src'

export type LibraryDocumentMetadata = Omit<DocumentPublication, 'content'> & {
  id: string
  capabilityId: string
  capabilityName: string
  format: 'markdown'
  sizeBytes: number
  createdAt: string
  updatedAt: string
}

export type LibraryDocument = LibraryDocumentMetadata & {
  content: string
}

const browserLibraryKey = 'personal-workbench-document-library'

type BrowserLibraryDocument = LibraryDocument

function readBrowserLibrary(): BrowserLibraryDocument[] {
  try {
    const source = window.localStorage.getItem(browserLibraryKey)
    if (!source) return []
    const parsed: unknown = JSON.parse(source)
    return Array.isArray(parsed) ? parsed as BrowserLibraryDocument[] : []
  } catch {
    return []
  }
}

function writeBrowserLibrary(documents: BrowserLibraryDocument[]) {
  window.localStorage.setItem(browserLibraryKey, JSON.stringify(documents))
}

export async function publishCapabilityDocument(
  capabilityId: string,
  capabilityName: string,
  document: DocumentPublication,
): Promise<void> {
  if (window.__TAURI_INTERNALS__) {
    await invoke('capability_documents_publish', {
      request: { capabilityId, document },
    })
    return
  }

  const documents = readBrowserLibrary()
  const [year, month] = document.documentDate.split('-')
  const id = `${capabilityId}/${document.collectionKey}/${year}/${month}/${document.key}`
  const current = documents.find((item) => item.id === id)
  const now = new Date().toISOString()
  const next: BrowserLibraryDocument = {
    ...document,
    id,
    capabilityId,
    capabilityName,
    format: 'markdown',
    sizeBytes: new TextEncoder().encode(document.content).length,
    createdAt: current?.createdAt ?? now,
    updatedAt: now,
  }
  writeBrowserLibrary([...documents.filter((item) => item.id !== id), next])
}

export async function listLibraryDocuments(): Promise<LibraryDocumentMetadata[]> {
  if (window.__TAURI_INTERNALS__) {
    return invoke<LibraryDocumentMetadata[]>('library_list_documents')
  }
  return readBrowserLibrary()
    .map(({ content: _content, ...metadata }) => metadata)
    .sort((left, right) => right.documentDate.localeCompare(left.documentDate))
}

export async function readLibraryDocument(id: string): Promise<LibraryDocument> {
  if (window.__TAURI_INTERNALS__) {
    return invoke<LibraryDocument>('library_read_document', { id })
  }
  const document = readBrowserLibrary().find((item) => item.id === id)
  if (!document) throw new Error('资料库文档不存在')
  return document
}

export async function searchLibraryContent(query: string): Promise<string[]> {
  if (!query.trim()) return []
  if (window.__TAURI_INTERNALS__) return invoke('library_search_content', { query })
  return readBrowserLibrary().filter((doc) => doc.content.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).map((doc) => doc.id)
}
