import { useEffect, useRef, useState } from 'react'
import { changeLibrary } from '../../platform/document-library.ts'

export type LibraryCreation = { kind: 'document' | 'import'; folderId?: string; files?: File[] }
export function LibraryManager({ language, onOpen, creation, onCloseCreation, refresh }: {
  language: 'zh' | 'en'; onOpen(id: string, folderId?: string): void
  creation: LibraryCreation | null; onCloseCreation(): void; refresh(): void
}) {
  const zh = language === 'zh'
  const busy = useRef(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const loadFiles = async (files: File[], folderId?: string) => {
    if (busy.current) { setError(zh ? '正在导入资料，请完成后重试。' : 'An import is in progress. Please try again when it finishes.'); onCloseCreation(); return }
    busy.current = true; setImporting(true); setError(''); onCloseCreation()
    let lastId: string | undefined
    try {
      if (!files.length) return
      if (files.length > 50 || files.some(file => !/\.(md|txt)$/i.test(file.name) || file.size > 2_000_000)) throw new Error(zh ? '请选择最多 50 个 Markdown/TXT 文件，每个不超过 2 MB。' : 'Choose up to 50 Markdown/TXT files, each under 2 MB.')
      const documents = await Promise.all(files.map(async file => ({ key: crypto.randomUUID(), title: file.name.replace(/\.(md|txt)$/i, ''), content: await file.text(), documentDate: new Date().toLocaleDateString('en-CA'), collectionKey: 'imports', collectionName: 'Imports' })))
      if (documents.some(doc => !doc.title.trim() || !doc.content.trim())) throw new Error(zh ? '文件名和正文不能为空。' : 'File names and content must not be empty.')
      for (const document of documents) {
        const saved = await changeLibrary({ kind: 'import', folderId, document })
        if (saved) lastId = saved.id
      }
    } catch (reason) { setError(String(reason)) }
    finally {
      busy.current = false; setImporting(false); refresh()
      if (lastId) onOpen(lastId, folderId)
    }
  }
  useEffect(() => {
    const input = fileInput.current!
    input.addEventListener('cancel', onCloseCreation)
    if (creation?.kind === 'import') {
      if (creation.files) void loadFiles(creation.files, creation.folderId)
      else input.click()
    }
    return () => input.removeEventListener('cancel', onCloseCreation)
  }, [creation])
  return <>
    <input ref={fileInput} hidden type="file" accept=".md,.txt,text/plain,text/markdown" multiple onChange={event => { void loadFiles(Array.from(event.target.files ?? []), creation?.folderId); event.target.value = '' }} />
    {importing && <p role="status" className="library-notice">{zh ? '导入中…' : 'Importing…'}</p>}
    {error && <p role="alert" className="library-error">{error}</p>}
  </>
}
