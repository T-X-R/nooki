import type { LibraryFolder, LibraryDocumentMetadata } from '../../platform/library-store.ts'

export type FolderAttachment = { id: string; name: string; documents: { id: string; title: string }[]; folders: FolderAttachment[] }
export type LibrarySelection = { documentIds: string[]; folders: FolderAttachment[] }

export function captureFolderAttachment(folders: LibraryFolder[], documents: LibraryDocumentMetadata[], id: string, visited = new Set<string>()): FolderAttachment {
  const folder = folders.find(item => item.id === id)
  if (!folder || visited.has(id)) throw new Error('文件夹已不存在或目录无效 / Folder not found or invalid hierarchy')
  const seen = new Set([...visited, id])
  return { id, name: folder.name, documents: documents.filter(doc => folder.documentIds.includes(doc.id)).map(doc => ({ id: doc.id, title: doc.title })), folders: folders.filter(item => item.parentId === id).map(child => captureFolderAttachment(folders, documents, child.id, seen)) }
}
export function attachmentDocumentIds(folders: FolderAttachment[]): string[] {
  return [...new Set(folders.flatMap(folder => [...folder.documents.map(doc => doc.id), ...attachmentDocumentIds(folder.folders)]))]
}
export function folderAttachmentContext(folders: FolderAttachment[]): string {
  return folders.length ? `\nLibrary folders attached by the user, including all nested folders and documents. Empty folders are retained. Document IDs refer to the attached Library sources.\n${JSON.stringify(folders)}` : ''
}
