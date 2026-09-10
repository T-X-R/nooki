import { useEffect, useState } from 'react'
import { ReloadIcon } from '@radix-ui/react-icons'
import { LibraryDialog } from './LibraryDialogs'
import { listLibraryDocuments, libraryOrganization, type LibraryDocumentMetadata, type Organization } from './document-library'
import { buildLibraryTree } from './library-tree'
import { CONVERSATION_OWNER, type SaveAnswerInput } from './conversation-model'
import { taskRunner } from './tasks'
import { ConversationDestinationSelect } from './ConversationDestinationSelect'

export function ConversationSaveDialog({ input, onClose }: { input: SaveAnswerInput; onClose(): void }) {
  const zh = input.language === 'zh'
  const [library, setLibrary] = useState<{ documents: LibraryDocumentMetadata[]; organization: Organization } | null>(null)
  const [topicId, setTopicId] = useState('')
  const [sectionId, setSectionId] = useState(CONVERSATION_OWNER)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  useEffect(() => {
    let current = true
    setLibrary(null); setError('')
    void Promise.all([listLibraryDocuments(), libraryOrganization()]).then(([documents, organization]) => {
      if (current) setLibrary({ documents, organization })
    }).catch((reason) => { if (current) setError(String(reason)) })
    return () => { current = false }
  }, [reload])
  const topic = library?.organization.topics.find((topic) => topic.id === topicId)
  const scoped = library?.documents.filter((doc) => !topicId || topic?.documentIds.includes(doc.id)) ?? []
  const sections = buildLibraryTree(scoped, new Map([[CONVERSATION_OWNER, zh ? '对话' : 'Conversations']]), library?.organization.customSections).map((node) => ({ id: node.capabilityId, name: node.capabilityName }))
  if ((!topicId || !scoped.length) && !sections.some((section) => section.id === CONVERSATION_OWNER)) sections.unshift({ id: CONVERSATION_OWNER, name: zh ? '对话' : 'Conversations' })
  const section = sections.find((section) => section.id === sectionId) ?? sections[0]
  const save = async () => {
    setBusy(true); setError('')
    try {
      await taskRunner.start(CONVERSATION_OWNER, 'save-answer', { ...input, destination: { topicId: topicId || undefined, section } })
      onClose()
    } catch (reason) { setError(String(reason)) } finally { setBusy(false) }
  }
  return <LibraryDialog className="conversation-save-dialog" title={zh ? '保存到资料库' : 'Save to Library'} busy={busy} onClose={onClose}>
    {!library && !error && <p className="conversation-state" role="status"><ReloadIcon className="spin" />{zh ? '正在读取保存位置…' : 'Loading destinations…'}</p>}
    {library && <div className="conversation-save-destination">
      <ConversationDestinationSelect label={zh ? '专题' : 'Topic'} autoFocus value={topicId} disabled={busy} options={[{ id: '', name: zh ? '默认' : 'Default' }, ...library.organization.topics]} onChange={(id) => { setTopicId(id); setSectionId(CONVERSATION_OWNER) }} />
      <ConversationDestinationSelect label={zh ? '栏目' : 'Section'} value={section.id} disabled={busy} options={sections} onChange={setSectionId} />
    </div>}
    {error && <p role="alert" className="library-error">{error}</p>}
    <footer className="modal-footer">{!library && error && <button className="secondary-button" onClick={() => setReload((value) => value + 1)}>{zh ? '重新读取' : 'Reload'}</button>}<button className="secondary-button" disabled={busy} onClick={onClose}>{zh ? '取消' : 'Cancel'}</button><button className="primary-button" disabled={!library || busy || (!!topicId && !topic)} onClick={() => void save()}>{busy ? (zh ? '保存中…' : 'Saving…') : (zh ? '保存' : 'Save')}</button></footer>
  </LibraryDialog>
}
