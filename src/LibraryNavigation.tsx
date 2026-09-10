import { ArchiveIcon, CheckIcon, ChevronRightIcon, Cross2Icon, Pencil2Icon, PlusIcon, TrashIcon } from '@radix-ui/react-icons'
import { useEffect, useState } from 'react'
import { changeLibrary, libraryOrganization, type Organization } from './document-library'

export function LibraryNavigation({ language, active, topicId, organization, error: loadError, onEnter, onSelect }: {
  language: 'zh' | 'en'; active: boolean; topicId: string; organization: Organization; error: string
  onEnter(): void; onSelect(id: string): void
}) {
  const zh = language === 'zh'
  const [expanded, setExpanded] = useState(active)
  const [draft, setDraft] = useState<{ id: string; name: string } | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { if (active) setExpanded(true) }, [active])
  const act = async (fn: () => Promise<void>) => {
    setBusy(true); setError('')
    try { await fn() } catch (reason) { setError(String(reason)) } finally { setBusy(false) }
  }
  const editor = <form className="nav-inline-editor" onSubmit={(e) => {
    e.preventDefault(); if (!draft?.name.trim() || busy) return
    void act(async () => {
      const latest = await libraryOrganization()
      const topic = latest.topics.find((topic) => topic.id === draft.id)
      if (draft.id && !topic) throw new Error(zh ? '专题已不存在，请重新创建。' : 'This topic no longer exists. Create a new topic.')
      await changeLibrary({ kind: 'save-topic', topic: { id: draft.id || crypto.randomUUID(), name: draft.name, documentIds: topic?.documentIds ?? [] } })
      setDraft(null)
    })
  }}><input autoFocus aria-label={zh ? '专题名称' : 'Topic name'} maxLength={80} value={draft?.name ?? ''} disabled={busy} onChange={(e) => setDraft((value) => value && { ...value, name: e.target.value })} onKeyDown={(e) => { if (e.key === 'Escape' && !busy) { e.preventDefault(); setDraft(null); setError('') } }} /><button className="icon-button" type="submit" disabled={busy || !draft?.name.trim()} aria-label={zh ? '保存专题' : 'Save topic'}><CheckIcon /></button><button className="icon-button" type="button" disabled={busy} onClick={() => setDraft(null)} aria-label={zh ? '取消' : 'Cancel'}><Cross2Icon /></button></form>
  return <div className="nav-conversations nav-library">
    <button className={`nav-item ${active ? 'is-active' : ''}`} aria-label={zh ? '资料库' : 'Library'} aria-current={active ? 'page' : undefined} aria-expanded={expanded} aria-controls="sidebar-library-topics" onClick={() => { setExpanded(active ? !expanded : true); onEnter() }}><span className="nav-item-main"><ArchiveIcon />{zh ? '资料库' : 'Library'}</span><ChevronRightIcon /></button>
    {expanded && <div className="nav-conversation-history" id="sidebar-library-topics">
      <button aria-current={active && !topicId ? 'page' : undefined} onClick={() => onSelect('')}><span>{zh ? '全部资料' : 'All documents'}</span></button>
      {organization.topics.map((topic) => <div key={topic.id}>
        {draft?.id === topic.id ? editor : <div className="nav-list-row">
          <button className="nav-row-label" title={topic.name} aria-current={active && topicId === topic.id ? 'page' : undefined} onClick={() => onSelect(topic.id)}><span>{topic.name}</span></button>
          <div className="nav-row-actions"><button className="icon-button" disabled={busy} aria-label={`${zh ? '重命名专题' : 'Rename topic'}：${topic.name}`} title={zh ? '重命名' : 'Rename'} onClick={() => { setDraft({ id: topic.id, name: topic.name }); setDeleting(null); setError('') }}><Pencil2Icon /></button><button className="icon-button" disabled={busy} aria-label={`${zh ? '删除专题' : 'Delete topic'}：${topic.name}`} title={zh ? '删除专题' : 'Delete topic'} onClick={() => { setDeleting(topic.id); setDraft(null); setError('') }}><TrashIcon /></button></div>
        </div>}
        {deleting === topic.id && <div className="nav-inline-confirm"><p>{zh ? '删除此专题？资料会保留。' : 'Delete this topic? Documents stay.'}</p><div><button disabled={busy} onClick={() => setDeleting(null)}>{zh ? '取消' : 'Cancel'}</button><button className="library-delete-action" disabled={busy} onClick={() => void act(async () => { await changeLibrary({ kind: 'delete-topic', id: topic.id }); setDeleting(null); if (topicId === topic.id) onSelect('') })}>{zh ? '删除专题' : 'Delete topic'}</button></div></div>}
      </div>)}
      {draft?.id === '' ? editor : <button disabled={busy} onClick={() => { setDraft({ id: '', name: '' }); setDeleting(null); setError('') }}><PlusIcon /><span>{zh ? '新建专题' : 'New topic'}</span></button>}
      {(error || loadError) && <p role="alert" className="library-error">{error || loadError}</p>}
    </div>}
  </div>
}
