import type { DocumentPublication, DocumentReference } from './index.ts'

export function publicationReference(capabilityId: string, document: DocumentPublication): DocumentReference {
  return { kind: 'library-document', documentId: `${capabilityId}/${document.collectionKey}/${document.documentDate.slice(0, 4)}/${document.documentDate.slice(5, 7)}/${document.key}`, title: document.title }
}

export function referenceHref(reference: DocumentReference): string {
  return `#workbench-source=${encodeURIComponent(JSON.stringify(reference))}`
}

export function parseReferenceHref(href: string): DocumentReference | null {
  if (!href.startsWith('#workbench-source=')) return null
  try {
    const value = JSON.parse(decodeURIComponent(href.slice('#workbench-source='.length)))
    return value?.kind === 'library-document' && typeof value.documentId === 'string' && typeof value.title === 'string'
      && (value.grantId === undefined || typeof value.grantId === 'string') ? value : null
  } catch { return null }
}
