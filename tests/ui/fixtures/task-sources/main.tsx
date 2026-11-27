import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { TaskReferences } from '../../../../src/features/task-board/TaskReferences'
import type { DocumentReference } from '../../../../packages/capability-contract/src'
import '../../../../src/app/global.css'
import '../../../../src/features/task-board/task-board.css'

const reference: DocumentReference = { kind: 'library-document', documentId: 'example.notes/notes/2026/11/minutes', title: '原始会议资料 Original selected notes with a long descriptive title', grantId: 'selected', revision: 'original' }
function Harness() {
  const [zh, setZh] = useState(false), [snapshot, setSnapshot] = useState(false), [visible, setVisible] = useState(true)
  const [opened, setOpened] = useState<DocumentReference | null>(null)
  useEffect(() => {
    const open = (event: Event) => setOpened((event as CustomEvent<DocumentReference>).detail)
    window.addEventListener('workbench:open-document', open)
    return () => window.removeEventListener('workbench:open-document', open)
  }, [])
  return <main style={{ padding: 24, minHeight: '100%', background: 'var(--bg)' }}>
    <h1>Task source UI verification</h1><p>SIMULATED navigation; native source reads are verified separately.</p>
    <label>Language <select onChange={event => setZh(event.target.value === 'zh')}><option value="en">English</option><option value="zh">中文</option></select></label>{' '}
    <label>Theme <select onChange={event => { document.documentElement.dataset.theme = event.target.value }}><option value="light">Light</option><option value="dark">Dark</option></select></label>
    <p><label><input type="checkbox" checked={snapshot} onChange={event => setSnapshot(event.target.checked)} /> Delegated snapshot</label></p>
    <TaskReferences zh={zh} sources={visible ? [{ id: reference.documentId, title: reference.title, reference }] : []} snapshotId={snapshot ? 'captured-task' : undefined} onRemove={() => setVisible(false)} />
    <TaskReferences zh={zh} sources={[{ id: 'example.notes/notes/2026/11/current', title: 'Plain current document' }]} />
    <pre aria-label="Opened reference" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(opened, null, 2)}</pre>
  </main>
}
createRoot(document.getElementById('root')!).render(<Harness />)
