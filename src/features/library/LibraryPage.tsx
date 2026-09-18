import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ArrowRightIcon, CalendarIcon, ChatBubbleIcon, CheckIcon, ChevronRightIcon, Cross2Icon, ExclamationTriangleIcon, FileTextIcon, MagnifyingGlassIcon, ReloadIcon, TrashIcon } from '@radix-ui/react-icons'
import type { DocumentReference, SelectedDocument } from '../../../packages/capability-contract/src/index.ts'
import { parseReferenceHref } from '../../../packages/capability-contract/src/references.ts'
import type { InstalledCapability } from '../../platform/capability-host.ts'
import { grantSelectedDocuments, readSourceReference } from '../../platform/document-grants.ts'
import { libraryOrganization, listLibraryDocuments, readLibraryDocument, searchLibraryContent, type LibraryDocument, type LibraryDocumentMetadata, type Origin } from '../../platform/document-library.ts'
import type { Organization } from '../../platform/library-store.ts'
import { CONVERSATION_OWNER, LEGACY_REVIEW } from '../conversation/conversation-model.ts'
import { capabilityCopy, CapabilityIcon } from '../capabilities/capability-presentation.tsx'
import { useWorkbench } from '../../platform/preferences.ts'
import { buildLibraryTree, filterLibraryTree, visibleLibrarySelection } from './library-tree.ts'
import { DeleteDocumentsDialog, EditDocumentDialog, HistoryDialog } from './LibraryDialogs.tsx'
import { LibraryManager } from './LibraryManager.tsx'
import { LibrarySectionComposer } from './LibrarySectionComposer.tsx'

function LibraryMarkdown({ content, onDocument }: { content: string; onDocument: (reference: DocumentReference) => void }) {
  return <Markdown remarkPlugins={[remarkGfm]} components={{ a: ({ href, children }) => {
    const reference = parseReferenceHref(href ?? '')
    return reference ? <a href={href} onClick={(event) => { event.preventDefault(); onDocument(reference) }}>{children}</a> : <a href={href}>{children}</a>
  } }}>{content}</Markdown>
}

export function LibraryPage({ topicId, organization, onSelectTopic, installed, target, onAddToConversation, onOpenCapability, onDocument }: { topicId: string; organization: Organization; onSelectTopic(id: string): void; installed: InstalledCapability[]; target: DocumentReference | null; onAddToConversation(ids: string[]): void; onOpenCapability: (id: string) => void; onDocument: (reference: DocumentReference) => void }) {
  const { t } = useTranslation()
  const { language } = useWorkbench()
  const [documents, setDocuments] = useState<LibraryDocumentMetadata[]>([])
  const [refreshKey, setRefreshKey] = useState(0)
  const [deleteIds, setDeleteIds] = useState<string[] | null>(null)
  const scopeIds = topicId ? organization.topics.find((topic) => topic.id === topicId)?.documentIds ?? [] : null
  const [editing, setEditing] = useState<LibraryDocument | null>(null)
  const [history, setHistory] = useState<LibraryDocument | null>(null)
  const [origins, setOrigins] = useState<Record<string, Origin>>({})
  const refreshLibrary = () => setRefreshKey((key) => key + 1)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedDocument, setSelectedDocument] = useState<LibraryDocument | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [documentError, setDocumentError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [contentMatches, setContentMatches] = useState<Set<string>>(new Set())
  const [searchError, setSearchError] = useState<string | null>(null)
  const [selectedInputs, setSelectedInputs] = useState<Set<string>>(new Set())
  const [grantOpen, setGrantOpen] = useState(false)
  const [recipient, setRecipient] = useState('')
  const [grantBusy, setGrantBusy] = useState(false)
  const [grantError, setGrantError] = useState<string | null>(null)
  const [thisWeek, setThisWeek] = useState(false)
  const [sourceTarget, setSourceTarget] = useState<DocumentReference | null>(null)
  const [source, setSource] = useState<SelectedDocument | null>(null)
  useEffect(() => { setSourceTarget(null); setSelectedId(null); setSelectedDocument(null); setSelectedInputs(new Set()); setQuery(''); setThisWeek(false) }, [topicId])
  useEffect(() => { window.addEventListener('workbench:library-changed', refreshLibrary); return () => window.removeEventListener('workbench:library-changed', refreshLibrary) }, [])
  const recipients = installed.filter((cap) => cap.manifest.id !== LEGACY_REVIEW && cap.enabled && cap.manifest.permissions.includes('documents.read-selected'))
  const monday = new Date(); monday.setDate(monday.getDate() - (monday.getDay() + 6) % 7)
  const sunday = new Date(monday); sunday.setDate(sunday.getDate() + 6)
  const inWeek = (date: string) => date >= monday.toLocaleDateString('en-CA') && date <= sunday.toLocaleDateString('en-CA')
  useEffect(() => {
    let current = true
    setContentMatches(new Set()); setSearchError(null)
    const timer = window.setTimeout(() => { void searchLibraryContent(query).then((ids) => { if (current) setContentMatches(new Set(ids)) }).catch((reason) => { if (current) setSearchError(String(reason)) }) }, 150)
    return () => { current = false; window.clearTimeout(timer) }
  }, [query, documents])
  useEffect(() => {
    if (!target) return
    setSourceTarget(target.grantId || target.snapshotId ? target : null)
    setSelectedId(target.documentId)
  }, [target])
  const [collapsedCapabilities, setCollapsedCapabilities] = useState<Set<string>>(() => new Set())
  const installedNames = useMemo(() => new Map<string, string>(installed.map((capability): [string, string] => [
    capability.manifest.id,
    capabilityCopy(capability, language).name,
  ]).concat([[CONVERSATION_OWNER, language === 'zh' ? '对话' : 'Conversations'], ['workbench.imports', language === 'zh' ? '导入资料' : 'Imports']])), [installed, language])
  const tree = useMemo(() => buildLibraryTree(documents.filter((doc) => (!thisWeek || inWeek(doc.documentDate)) && (!scopeIds || scopeIds.includes(doc.id))), installedNames, organization.customSections), [documents, installedNames, thisWeek, scopeIds, organization.customSections])
  const filteredTree = useMemo(() => filterLibraryTree(tree, query, contentMatches), [tree, query, contentMatches])
  const visibleIds = useMemo(() => filteredTree.flatMap((cap) => cap.collections.flatMap((collection) => collection.months.flatMap((month) => month.documents.map((doc) => doc.id)))), [filteredTree])
  const visibleIdSet = useMemo(() => new Set(visibleIds), [visibleIds])
  const searching = query.trim().length > 0
  useEffect(() => {
    if (!sourceTarget) setSelectedId((id) => visibleLibrarySelection(visibleIds, id))
    setSelectedInputs((ids) => { const next = [...ids].filter((id) => visibleIdSet.has(id)); return next.length === ids.size ? ids : new Set(next) })
  }, [visibleIds, visibleIdSet, sourceTarget])
  const currentDocument = selectedDocument?.id === selectedId && visibleIdSet.has(selectedDocument.id) ? selectedDocument : null

  const toggleKey = (current: Set<string>, key: string) => {
    const next = new Set(current)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  }

  useEffect(() => {
    let current = true
    setLoading(true)
    listLibraryDocuments()
      .then((next) => {
        if (!current) return
        setDocuments(next)
        setSelectedId((previous) => next.some((doc) => doc.id === previous) ? previous : next.some((doc) => doc.id === target?.documentId) ? target!.documentId : next[0]?.id ?? null)
        setSelectedInputs((previous) => new Set([...previous].filter((id) => next.some((doc) => doc.id === id))))
        void libraryOrganization().then((value) => { if (current) setOrigins(value.origins) }).catch((reason) => { if (current) setError(String(reason)) })
        setError(null)
      })
      .catch(() => current && setError(t('libraryLoadFailed')))
      .finally(() => current && setLoading(false))
    return () => { current = false }
  }, [t, refreshKey])

  useEffect(() => {
    let current = true
    setSelectedDocument(null)
    setSource(null)
    setDocumentError(null)
    if (!selectedId && !sourceTarget) return () => { current = false }
    const read = sourceTarget
      ? readSourceReference(sourceTarget).then((doc) => { if (current) setSource(doc) })
      : readLibraryDocument(selectedId!).then((doc) => { if (current) setSelectedDocument(doc) })
    read
      .catch(() => current && setDocumentError(t('libraryDocumentLoadFailed')))
    return () => { current = false }
  }, [selectedId, sourceTarget, t, refreshKey])

  const locale = language === 'zh' ? 'zh-CN' : 'en-US'


  return (
    <div className="content-column library-page">
      <div className="page-header-row library-page-heading">
        <h1><span>{language === 'zh' ? '认真留下的，' : 'What you keep '}</span><span>{language === 'zh' ? '值得再读一遍。' : 'is worth returning to.'}</span></h1>
        <span className="library-total">{documents.filter((doc) => !scopeIds || scopeIds.includes(doc.id)).length} {t('libraryDocuments')}</span>
      </div>
      <LibraryManager topicId={topicId} onSelectTopic={onSelectTopic} language={language} documents={documents} selected={[...selectedInputs]} onOpen={(id) => { setQuery(''); setThisWeek(false); setSelectedId(id); setSourceTarget(null) }} onDiscuss={onAddToConversation} refresh={refreshLibrary} onClear={() => setSelectedInputs(new Set())}
        filters={<div className="library-period-filter" role="group" aria-label={language === 'zh' ? '资料日期范围' : 'Document date range'}><button aria-pressed={!thisWeek} onClick={() => setThisWeek(false)}>{language === 'zh' ? '全部' : 'All'}</button><button aria-pressed={thisWeek} onClick={() => setThisWeek(true)}><CalendarIcon />{language === 'zh' ? '本周' : 'This week'}</button></div>}
        selectionActions={<>{!!recipients.length && <button className="library-grant-action" onClick={() => { setRecipient(recipients[0]?.manifest.id ?? ''); setGrantError(null); setGrantOpen(true) }}>{language === 'zh' ? '授权读取' : 'Authorize access'}</button>}<button className="library-conversation-action" disabled={selectedInputs.size > 50} onClick={() => onAddToConversation([...selectedInputs])}><ChatBubbleIcon />{language === 'zh' ? '添加到对话' : 'Add to conversation'}</button></>}
      />
      {editing && <EditDocumentDialog document={editing} language={language} onClose={() => setEditing(null)} onSaved={refreshLibrary} />}
      {history && <HistoryDialog document={history} language={language} onClose={() => setHistory(null)} onSaved={refreshLibrary} />}
      {deleteIds && <DeleteDocumentsDialog ids={deleteIds} language={language} onClose={() => setDeleteIds(null)} onDeleted={refreshLibrary} />}
      {searchError && <p role="alert">{searchError}</p>}
      {grantOpen && <div className="modal-backdrop"><section className="modal grant-modal" role="dialog" aria-modal="true" aria-labelledby="grant-title"><div className="modal-header"><div><span className="section-kicker">DOCUMENT ACCESS</span><h2 id="grant-title">{language === 'zh' ? '确认资料授权' : 'Confirm document access'}</h2></div><button className="icon-button" disabled={grantBusy} onClick={() => setGrantOpen(false)} aria-label={t('close')}><Cross2Icon /></button></div>
        <p className="modal-copy">{language === 'zh' ? '只授权读取以下资料的当前快照。能力可将这些内容用于 AI 生成；不会获得全库或其他能力私有数据的访问权。' : 'Authorize only the current snapshots listed below. The capability may use them for AI generation; this does not grant access to the entire Library or private capability storage.'}</p>
        <div className="grant-section-label"><span>{language === 'zh' ? '所选资料' : 'Selected documents'}</span><small>{selectedInputs.size}</small></div>
        <ul className="grant-document-list">{documents.filter((doc) => selectedInputs.has(doc.id)).map((doc) => <li key={doc.id}><span className="grant-document-icon"><FileTextIcon /></span><span><strong>{doc.title}</strong><small>{installedNames.get(doc.capabilityId) ?? doc.capabilityName} · {doc.documentDate}</small></span></li>)}</ul>
        <fieldset className="grant-recipients"><legend>{language === 'zh' ? '允许哪个能力读取' : 'Allow access to'}</legend><div className="grant-recipient-list">{recipients.map((cap) => <label className={`grant-recipient ${recipient === cap.manifest.id ? 'is-selected' : ''}`} key={cap.manifest.id}><input type="radio" name="document-recipient" value={cap.manifest.id} checked={recipient === cap.manifest.id} disabled={grantBusy} onChange={() => setRecipient(cap.manifest.id)} /><span className="grant-recipient-icon"><CapabilityIcon name={cap.manifest.icon} /></span><span><strong>{capabilityCopy(cap, language).name}</strong><small>{capabilityCopy(cap, language).description}</small></span><CheckIcon className="grant-recipient-check" aria-hidden="true" /></label>)}</div></fieldset>
        {!recipients.length && <p>{language === 'zh' ? '请先安装并启用支持所选文档读取的能力。' : 'Install and enable a capability that supports selected documents.'}</p>}
        {grantError && <p role="alert">{grantError}</p>}
        <div className="modal-footer"><button className="secondary-button" disabled={grantBusy} onClick={() => setGrantOpen(false)}>{language === 'zh' ? '取消' : 'Cancel'}</button><button className="primary-button" disabled={grantBusy || !recipient} onClick={() => { setGrantBusy(true); void grantSelectedDocuments(recipient, [...selectedInputs]).then(() => { setGrantOpen(false); onOpenCapability(recipient) }).catch((reason) => setGrantError(String(reason))).finally(() => setGrantBusy(false)) }}>{language === 'zh' ? '授权并打开能力' : 'Authorize and open'}<ArrowRightIcon /></button></div>
      </section></div>}
      <div className="library-workspace">
        {loading ? <div className="library-state"><ReloadIcon className="spin" /><span>{t('libraryLoading')}</span></div>
          : error && documents.length === 0 ? <div className="library-state library-state-error"><ExclamationTriangleIcon /><span>{error}</span></div>
            : <>
                <nav className="library-tree" aria-label={t('libraryTree')}>
                  <label className="library-tree-search">
                    <MagnifyingGlassIcon />
                    <input
                      type="search"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder={language === 'zh' ? '搜索资料…' : 'Search documents…'}
                      aria-label={t('librarySearch')}
                    />
                  </label>
                  <div className="library-list-caption"><label><input type="checkbox" aria-label={language === 'zh' ? '选择当前列表全部资料' : 'Select all visible documents'} checked={!!visibleIds.length && visibleIds.every((id) => selectedInputs.has(id))} ref={(el) => { if (el) el.indeterminate = selectedInputs.size > 0 && selectedInputs.size < visibleIds.length }} disabled={!visibleIds.length} onChange={(e) => setSelectedInputs(e.target.checked ? new Set(visibleIds) : new Set())} />{language === 'zh' ? '全选' : 'Select all'}</label><span>{visibleIds.length} {language === 'zh' ? '篇资料' : 'documents'}</span></div>
                  <LibrarySectionComposer language={language} />
                  {filteredTree.length === 0
                    ? <div className="library-search-empty">{searching ? t('libraryNoSearchResults') : language === 'zh' ? '暂无资料' : 'No documents'}</div>
                    : filteredTree.map((capability) => {
                      const expanded = searching || !collapsedCapabilities.has(capability.capabilityId)
                      return <section className="library-capability-node" key={capability.capabilityId}>
                        <button type="button" className="library-capability-heading" aria-expanded={expanded} disabled={searching} onClick={() => setCollapsedCapabilities((current) => toggleKey(current, capability.capabilityId))}>
                          <ChevronRightIcon className={`library-tree-chevron ${expanded ? 'is-expanded' : ''}`} /><span><strong>{capability.capabilityName}</strong></span><em>{capability.documentCount}</em>
                        </button>
                        {expanded && !capability.documentCount && <p className="library-section-empty">{language === 'zh' ? '选择资料后移入此栏目，或保存对话时选择这里。' : 'Move selected documents here, or choose this section when saving a conversation.'}</p>}
                        {expanded && capability.collections.map((collection) => <div key={collection.key}>
                          {capability.collections.length > 1 && <div className="library-collection-caption">{collection.name}</div>}
                          {collection.months.flatMap((month) => month.documents).map((doc) => <div className={`library-selectable-document ${selectedId === doc.id && !sourceTarget ? 'is-active' : ''}`} key={doc.id}>
                            <input type="checkbox" aria-label={`${language === 'zh' ? '选择' : 'Select'} ${doc.title}`} checked={selectedInputs.has(doc.id)} onChange={() => setSelectedInputs((current) => toggleKey(current, doc.id))} />
                            <button type="button" className="library-document-link" aria-current={selectedId === doc.id && !sourceTarget ? 'true' : undefined} onClick={() => { setSourceTarget(null); setSelectedId(doc.id) }}><span><strong>{doc.title}</strong><small>{doc.documentDate}</small></span></button>
                            <button className="icon-button library-row-delete" aria-label={`${language === 'zh' ? '删除' : 'Delete'} ${doc.title}`} title={language === 'zh' ? '删除资料' : 'Delete document'} onClick={() => setDeleteIds([doc.id])}><TrashIcon /></button>
                          </div>)}
                        </div>)}
                      </section>
                    })}
                </nav>

                <article className="library-reader" key={sourceTarget ? `${sourceTarget.documentId}:${sourceTarget.revision}` : selectedId}>
                  {source ? <><header className="library-reader-header"><span>{language === 'zh' ? '引用原文 · 使用时保存的快照' : 'Cited source · snapshot captured when used'}</span><h2>{source.reference.title}</h2><small>{source.documentDate} · {source.reference.revision}</small><button className="quiet-button" onClick={() => { setSourceTarget(null); setSelectedId(source.reference.documentId) }}>{language === 'zh' ? '查看当前文档' : 'View current document'}</button></header><div className="library-reader-content"><div className="library-reader-document"><LibraryMarkdown content={source.content} onDocument={onDocument} /></div></div></> : currentDocument ? <>
                    <header className="library-reader-header">
                      <h2>{currentDocument.title}</h2>
                      <div className="library-reader-details"><div className="library-reader-meta"><small>{t('libraryUpdated')} {new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(currentDocument.updatedAt))}</small></div>
                      <div className="library-document-actions"><button className="quiet-button" onClick={() => setEditing(currentDocument)}>{language === 'zh' ? '修订' : 'Revise'}</button><button className="quiet-button" onClick={() => setHistory(currentDocument)}>{language === 'zh' ? '版本历史' : 'Version history'}</button><button className="quiet-button" onClick={() => onAddToConversation([currentDocument.id])}>{language === 'zh' ? '继续讨论' : 'Discuss document'}</button><button className="quiet-button library-delete-action" onClick={() => setDeleteIds([currentDocument.id])}><TrashIcon />{language === 'zh' ? '删除' : 'Delete'}</button>{origins[currentDocument.id] && <button className="quiet-button" onClick={() => window.dispatchEvent(new CustomEvent('workbench:open-conversation', { detail: origins[currentDocument.id].threadId }))}>{language === 'zh' ? '原始对话' : 'Original conversation'}</button>}</div></div>
                    </header>
                    <div className="library-reader-content"><div className="library-reader-document"><LibraryMarkdown content={currentDocument.content} onDocument={onDocument} /></div></div>
                  </> : documentError ? <div className="library-state library-state-error"><ExclamationTriangleIcon /><span>{documentError}</span></div> : <div className="library-state"><FileTextIcon /><strong>{!visibleIds.length ? (language === 'zh' ? '这里还没有资料' : 'No documents here') : t('librarySelectDocument')}</strong><span>{!visibleIds.length ? (searching || thisWeek ? (language === 'zh' ? '试试其他关键词或日期范围。' : 'Try another search or date range.') : scopeIds ? (language === 'zh' ? '在全部资料中选择资料，再加入这个专题。' : 'Select documents in All documents and add them to this topic.') : t('libraryEmptyHint')) : ''}</span></div>}
                </article>
              </>}
      </div>
    </div>
  )
}
