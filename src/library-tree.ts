import type { LibraryDocumentMetadata } from './document-library'

export type LibraryMonthNode = {
  key: string
  documents: LibraryDocumentMetadata[]
}

export type LibraryCollectionNode = {
  key: string
  name: string
  documentCount: number
  months: LibraryMonthNode[]
}

export type LibraryCapabilityNode = {
  capabilityId: string
  capabilityName: string
  installed: boolean
  documentCount: number
  collections: LibraryCollectionNode[]
}

export function buildLibraryTree(
  documents: LibraryDocumentMetadata[],
  installedNames: ReadonlyMap<string, string>,
): LibraryCapabilityNode[] {
  const capabilities = new Map<string, LibraryCapabilityNode>()

  for (const document of documents) {
    let capability = capabilities.get(document.capabilityId)
    if (!capability) {
      capability = {
        capabilityId: document.capabilityId,
        capabilityName: installedNames.get(document.capabilityId) ?? document.capabilityName,
        installed: installedNames.has(document.capabilityId),
        documentCount: 0,
        collections: [],
      }
      capabilities.set(document.capabilityId, capability)
    }
    capability.documentCount += 1

    let collection = capability.collections.find((item) => item.key === document.collectionKey)
    if (!collection) {
      collection = {
        key: document.collectionKey,
        name: document.collectionName,
        documentCount: 0,
        months: [],
      }
      capability.collections.push(collection)
    }
    collection.documentCount += 1

    const monthKey = document.documentDate.slice(0, 7)
    let month = collection.months.find((item) => item.key === monthKey)
    if (!month) {
      month = { key: monthKey, documents: [] }
      collection.months.push(month)
    }
    month.documents.push(document)
  }

  return [...capabilities.values()]
    .sort((left, right) => left.capabilityName.localeCompare(right.capabilityName))
    .map((capability) => ({
      ...capability,
      collections: capability.collections
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((collection) => ({
          ...collection,
          months: collection.months
            .sort((left, right) => right.key.localeCompare(left.key))
            .map((month) => ({
              ...month,
              documents: month.documents.sort((left, right) => (
                right.documentDate.localeCompare(left.documentDate) || left.title.localeCompare(right.title)
              )),
            })),
        })),
    }))
}

export function filterLibraryTree(tree: LibraryCapabilityNode[], query: string, contentMatches: ReadonlySet<string> = new Set()): LibraryCapabilityNode[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery) return tree
  const matches = (value: string) => value.toLocaleLowerCase().includes(normalizedQuery)

  return tree.flatMap((capability) => {
    const capabilityMatches = matches(capability.capabilityId) || matches(capability.capabilityName)
    const collections = capability.collections.flatMap((collection) => {
      const collectionMatches = matches(collection.key) || matches(collection.name)
      const months = collection.months.flatMap((month) => {
        const includeMonth = capabilityMatches || collectionMatches || matches(month.key)
        const documents = includeMonth
          ? month.documents
          : month.documents.filter((document) => matches(document.title) || matches(document.documentDate) || contentMatches.has(document.id))
        return documents.length > 0 ? [{ ...month, documents }] : []
      })
      const documentCount = months.reduce((total, month) => total + month.documents.length, 0)
      return documentCount > 0 ? [{ ...collection, documentCount, months }] : []
    })
    const documentCount = collections.reduce((total, collection) => total + collection.documentCount, 0)
    return documentCount > 0 ? [{ ...capability, documentCount, collections }] : []
  })
}
