import type { LibraryFolder, Organization } from './library-store.ts'

export function migrateLibraryFolders(organization: Organization): LibraryFolder[] {
  if (organization.folders) return organization.folders
  const folders: LibraryFolder[] = []
  for (const topic of organization.topics) folders.push({ id: `topic-${topic.id}`, name: uniqueFolderName(folders, topic.name), documentIds: [...topic.documentIds] })
  const sections = new Map((organization.customSections ?? []).map(section => [section.id, section]))
  for (const section of Object.values(organization.sections ?? {})) if (!sections.has(section.id) && section.id !== 'workbench.documents' && section.id !== 'workbench.root') sections.set(section.id, section)
  for (const section of sections.values()) {
    const parentId = section.topicId && folders.some(folder => folder.id === `topic-${section.topicId}`) ? `topic-${section.topicId}` : undefined
    const folder: LibraryFolder = { id: `section-${section.id}`, name: uniqueFolderName(folders, section.name, parentId), ...(parentId ? { parentId } : {}), documentIds: [] }
    for (const [id, assigned] of Object.entries(organization.sections ?? {})) {
      if (assigned.id !== section.id) continue
      folder.documentIds.push(id)
      const parent = folders.find(folder => folder.id === parentId)
      if (parent) parent.documentIds = parent.documentIds.filter(value => value !== id)
    }
    folders.push(folder)
  }
  return folders
}
export function uniqueFolderName(folders: LibraryFolder[], requested: string, parentId?: string): string {
  let name = requested; let suffix = 2
  while (folders.some(folder => folder.parentId === parentId && folder.name.toLocaleLowerCase() === name.toLocaleLowerCase())) { const ending = ` (${suffix++})`; name = `${[...requested].slice(0, 80 - ending.length).join('')}${ending}` }
  return name
}
export function folderDestination(folders: LibraryFolder[], id?: string) {
  if (!id) return undefined
  const folder = folders.find(folder => folder.id === id)
  if (!folder) throw new Error('文件夹已不存在 / Folder not found')
  return folder
}
export function validateFolder(folders: LibraryFolder[], folder: LibraryFolder) {
  if (folder.parentId === '') throw new Error('无效的父文件夹 / Invalid parent folder')
  if (!/^[a-zA-Z0-9-]{1,200}$/.test(folder.id) || !folder.name.trim() || [...folder.name.trim()].length > 80) throw new Error('文件夹名称无效 / Invalid folder name')
  if (folders.some(item => item.id !== folder.id && item.parentId === folder.parentId && item.name.toLocaleLowerCase() === folder.name.trim().toLocaleLowerCase())) throw new Error('同名文件夹已存在 / Folder already exists')
  let parent = folderDestination(folders, folder.parentId)
  const seen = new Set([folder.id])
  while (parent) {
    if (seen.has(parent.id)) throw new Error('不能移入自身或子文件夹 / Folder cycle')
    seen.add(parent.id); parent = folderDestination(folders, parent.parentId)
  }
}
export function folderOptions(folders: LibraryFolder[], rootName: string, excludedId?: string) {
  const result = [{ id: '', name: rootName }]
  const visit = (parentId: string | undefined, path: string, seen: Set<string>) => {
    for (const folder of folders.filter(folder => folder.parentId === parentId)) {
      if (folder.id === excludedId || seen.has(folder.id)) continue
      const name = `${path} / ${folder.name}`
      result.push({ id: folder.id, name }); visit(folder.id, name, new Set([...seen, folder.id]))
    }
  }
  visit(undefined, rootName, new Set())
  return result
}
export function validateFolderInventory(organization: Organization, documentIds: Set<string>) {
  const folders = migrateLibraryFolders(organization)
  const seen = new Set<string>()
  for (const folder of folders) {
    if (seen.has(folder.id)) throw new Error('重复的文件夹标识 / Duplicate folder identity')
    seen.add(folder.id); validateFolder(folders, folder)
    if (folder.documentIds.some(id => !documentIds.has(id))) throw new Error('文件夹中的文档不存在 / Folder document not found')
  }
}
