import { useState, type ReactNode } from 'react'
import { DownloadIcon, FileTextIcon } from '@radix-ui/react-icons'
import type { DocumentReference } from '../packages/capability-contract/src'
import type { ConversationArtifact } from './conversation-documents'
import { DocumentComparison, LibraryDialog } from './LibraryDialogs'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { parseReferenceHref } from '../packages/capability-contract/src/references'
import { downloadText } from './user-data'
import { invoke } from '@tauri-apps/api/core'

export function ConversationArtifacts({ files, zh, onSave, onDocument, saveAction }: { files: ConversationArtifact[]; zh: boolean; onSave(file: ConversationArtifact): void; onDocument(reference: DocumentReference): void; saveAction(file: ConversationArtifact): ReactNode }) {
  const [preview, setPreview] = useState<ConversationArtifact | null>(null)
  const [compare, setCompare] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [downloading, setDownloading] = useState(false)
  const download = async (file: ConversationArtifact) => {
    setDownloading(true); setNotice(''); setError('')
    try {
      if (window.__TAURI_INTERNALS__) setNotice(await invoke<string>('conversation_export_document', { name: file.name, content: file.content }))
      else { downloadText(/\.(md|txt)$/i.test(file.name) ? file.name : `${file.name}.md`, file.content, 'text/plain;charset=utf-8'); setNotice(zh ? '文件已下载' : 'File downloaded') }
    } catch (reason) { setError(String(reason)) } finally { setDownloading(false) }
  }
  return <>
    <div className="conversation-artifacts">{files.map((file) => <article className="conversation-artifact" key={file.id}>
      <FileTextIcon /><div><strong>{file.name}</strong><small>{file.before === null ? (zh ? '新文档 · 本轮成果' : 'New document · Turn result') : (zh ? '已修改 · 本轮成果' : 'Revised document · Turn result')}</small></div>
      <button className="quiet-button" onClick={() => { setPreview(file); setCompare(false); setNotice(''); setError('') }}>{zh ? '预览' : 'Preview'}</button>
      {saveAction(file)}
    </article>)}</div>
    {preview && <LibraryDialog wide className="conversation-document-dialog" title={preview.name} busy={downloading} onClose={() => setPreview(null)}>
      <div className="conversation-document-tools"><span>{zh ? '本轮完成时的文档' : 'Document at the end of this turn'}</span>{preview.source && <button className="quiet-button" onClick={() => onDocument(preview.source!)}>{zh ? '查看引用原文' : 'View source'}</button>}{preview.before !== null && <button className="quiet-button" onClick={() => setCompare(!compare)}>{compare ? (zh ? '阅读文档' : 'Read document') : (zh ? '查看修改' : 'Compare changes')}</button>}</div>
      <div className="conversation-document-content">{compare && preview.before !== null ? <DocumentComparison before={preview.before} after={preview.content} /> : <div className="conversation-markdown"><Markdown remarkPlugins={[remarkGfm]} components={{ a: ({ href, children }) => { const reference = parseReferenceHref(href ?? ''); return reference ? <a href={href} onClick={(event) => { event.preventDefault(); onDocument(reference) }}>{children}</a> : <a href={href} target="_blank" rel="noreferrer">{children}</a> } }}>{preview.content}</Markdown></div>}</div>
      {notice && <p className="modal-copy" role="status">{notice}</p>}{error && <p className="library-error" role="alert">{error}</p>}
      <footer className="modal-footer"><button className="secondary-button" disabled={downloading} onClick={() => void download(preview)}><DownloadIcon />{zh ? '下载文件' : 'Download'}</button><button className="primary-button" disabled={downloading || !preview.content.trim()} onClick={() => { onSave(preview); setPreview(null) }}>{zh ? '保存到资料库' : 'Save to Library'}</button></footer>
    </LibraryDialog>}
  </>
}
