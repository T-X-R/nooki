import { useEffect, useState } from 'react'
import { ReloadIcon } from '@radix-ui/react-icons'
import { LibraryDialog } from '../library/LibraryDialogs.tsx'
import { libraryOrganization, type Organization } from '../../platform/document-library.ts'
import { folderOptions } from '../../platform/library-folders.ts'
import { CONVERSATION_OWNER, type SaveAnswerInput } from './conversation-model.ts'
import { taskRunner } from '../../platform/tasks.ts'
import { DestinationSelect } from '../../shared/DestinationSelect.tsx'

export function ConversationSaveDialog({ input, onClose }: { input: SaveAnswerInput; onClose(): void }) {
  const zh = input.language === 'zh'
  const [library, setLibrary] = useState<Organization | null>(null)
  const [folderId, setFolderId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  useEffect(() => {
    let current = true
    setLibrary(null); setError('')
    void libraryOrganization().then(organization => {
      if (current) setLibrary(organization)
    }).catch((reason) => { if (current) setError(String(reason)) })
    return () => { current = false }
  }, [reload])
  const save = async () => {
    setBusy(true); setError('')
    try {
      await taskRunner.start(CONVERSATION_OWNER, 'save-answer', { ...input, destination: { folderId: folderId || undefined } })
      onClose()
    } catch (reason) { setError(String(reason)) } finally { setBusy(false) }
  }
  return <LibraryDialog className="conversation-save-dialog" title={zh ? '保存到资料库' : 'Save to Library'} busy={busy} onClose={onClose}>
    {!library && !error && <p className="conversation-state" role="status"><ReloadIcon className="spin" />{zh ? '正在读取保存位置…' : 'Loading destinations…'}</p>}
    {library && <DestinationSelect label={zh ? '保存到文件夹' : 'Save to folder'} autoFocus value={folderId} disabled={busy} options={folderOptions(library.folders ?? [], zh ? '我的资料' : 'My documents')} onChange={setFolderId} />}
    {error && <p role="alert" className="library-error">{error}</p>}
    <footer className="modal-footer">{!library && error && <button className="secondary-button" onClick={() => setReload((value) => value + 1)}>{zh ? '重新读取' : 'Reload'}</button>}<button className="secondary-button" disabled={busy} onClick={onClose}>{zh ? '取消' : 'Cancel'}</button><button className="primary-button" disabled={!library || busy} onClick={() => void save()}>{busy ? (zh ? '保存中…' : 'Saving…') : (zh ? '保存' : 'Save')}</button></footer>
  </LibraryDialog>
}
