import { invoke } from '@tauri-apps/api/core'
import type { DocumentGrant, DocumentReference, SelectedDocument } from '../packages/capability-contract/src'
import { readLibraryDocument } from './document-library'
import { getRuntimeInstalledCapability } from './capability-runtime'

const key = 'personal-workbench-document-grants-v1'
type StoredGrant = Omit<DocumentGrant, 'documents'> & { documents: SelectedDocument[] }
const read = (): StoredGrant[] => JSON.parse(localStorage.getItem(key) ?? '[]')
function authorized(capabilityId: string) {
  const capability = getRuntimeInstalledCapability(capabilityId)
  if (!capability?.enabled || !capability.manifest.permissions.includes('documents.read-selected')) throw new Error('Capability requires documents.read-selected')
  return capability.manifest.version
}
function metadata({ documents, ...grant }: StoredGrant): DocumentGrant {
  return { ...grant, documents: documents.map(({ content: _content, ...document }) => document) }
}

// Platform UI only: deliberately absent from CapabilityHost.
export async function grantSelectedDocuments(capabilityId: string, ids: string[]): Promise<DocumentGrant> {
  const capabilityVersion = authorized(capabilityId)
  const unique = [...new Set(ids)]
  if (!unique.length || unique.length > 50) throw new Error('Select between 1 and 50 documents')
  const id = crypto.randomUUID()
  if (window.__TAURI_INTERNALS__) return invoke('library_grant_documents', { capabilityId, ids: unique, id })
  const documents = await Promise.all(unique.map(async (documentId): Promise<SelectedDocument> => {
    const document = await readLibraryDocument(documentId)
    return { reference: { kind: 'library-document', documentId, title: document.title, revision: document.updatedAt, grantId: id }, documentDate: document.documentDate, content: document.content }
  }))
  if (documents.reduce((size, doc) => size + new TextEncoder().encode(doc.content).length, 0) > 8_000_000) throw new Error('Selected documents exceed 8 MB')
  if (authorized(capabilityId) !== capabilityVersion) throw new Error('Capability changed; select documents again')
  const grant = { id, capabilityId, capabilityVersion, createdAt: new Date().toISOString(), documents }
  localStorage.setItem(key, JSON.stringify([...read(), grant]))
  return metadata(grant)
}

export async function listDocumentGrants(capabilityId: string): Promise<DocumentGrant[]> {
  const version = authorized(capabilityId)
  if (window.__TAURI_INTERNALS__) return invoke('capability_document_grants', { capabilityId })
  return read().filter((grant) => grant.capabilityId === capabilityId && grant.capabilityVersion === version).map(metadata)
}

export async function readSelectedDocument(capabilityId: string, grantId: string, documentId: string): Promise<SelectedDocument> {
  const version = authorized(capabilityId)
  if (window.__TAURI_INTERNALS__) return invoke('capability_read_selected_document', { capabilityId, grantId, documentId })
  const grant = read().find((item) => item.id === grantId && item.capabilityId === capabilityId && item.capabilityVersion === version)
  const document = grant?.documents.find((item) => item.reference.documentId === documentId)
  if (!document) throw new Error('Document is outside the authorized selection')
  return document
}

// The user can follow a retained citation even after uninstalling its Capability.
export async function readSourceReference(reference: DocumentReference): Promise<SelectedDocument> {
  if (!reference.grantId) {
    const doc = await readLibraryDocument(reference.documentId)
    return { reference, documentDate: doc.documentDate, content: doc.content }
  }
  if (window.__TAURI_INTERNALS__) return invoke('library_read_source', { grantId: reference.grantId, documentId: reference.documentId })
  const document = read().find((item) => item.id === reference.grantId)?.documents.find((item) => item.reference.documentId === reference.documentId)
  if (!document) throw new Error('Source snapshot not found')
  return document
}
