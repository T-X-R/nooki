import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { TaskSelectionDialog } from '../../../../src/features/task-board/TaskSelectionDialog'
import { TaskAccessDialog } from '../../../../src/features/task-board/TaskAccessDialog'
import { boardPicker } from '../../../../src/platform/board-picker'
import { createBoardSelectionClient } from '../../../../src/platform/capability-board-selection'
import { captureLibraryFocus } from '../../../../src/platform/library-focus'
import type { BoardGrant } from '../../../../packages/capability-contract/src'
import '../../../../src/app/global.css'

// Test entry only; never imported by the application. All authority and data here are simulated.
const id = 'org.example.ui-selection'
const docs = ['Alpha', 'Beta'].map((title,index) => ({ id: `synthetic/${title}`, title, revision:index+3, description:index ? 'Follow up with the design team.' : 'Prepare the meeting notes.' }))
const makeGrant = (ids: string[]): BoardGrant => ({ id: 'a'.repeat(64), capabilityId: id, capabilityVersion: '1.0.0', createdAt: '2026-11-26T00:00:00Z', purpose: 'Attach reviewed synthetic meeting notes.', operations:['attachDelivery'], items: ids.map(id => { const task = docs.find(doc => doc.id === id)!; return {id:task.id,revision:task.revision,title:mode === 'same-title' ? 'Shared title' : task.title} }) })
let mode = 'success', listCalls = 0, commitCalls = 0, revokeCalls = 0
let records: { grant: BoardGrant; status: 'active' | 'revoked' | 'stale' | 'inactive' }[] = [{ grant: makeGrant(['synthetic/Alpha']), status: 'active' }]
let audit: string[] = []
const delay = () => new Promise(resolve => setTimeout(resolve, 2500))
Object.assign(window, { __TAURI_INTERNALS__: { invoke: async (command: string) => {
  audit.push(command)
  if (command === 'task_board_read' || command === 'board_task_access') {
    listCalls++
    if (mode === 'loading') await delay()
    if (mode === 'list-error' && listCalls === 1) throw new Error('Synthetic listing failure')
    if (mode === 'empty') return command === 'task_board_read' ? {cards:[]} : []
    return command === 'task_board_read' ? {cards:mode === 'same-title' ? docs.map(doc => ({...doc,title:'Shared title'})) : docs} : structuredClone(records)
  }
  if (command === 'board_revoke_task_access') {
    revokeCalls++
    if (mode === 'revoke-error' && revokeCalls === 1) throw new Error('Synthetic unknown outcome')
    records[0].status = 'revoked'; return null
  }
  throw new Error(`Unexpected fixture command: ${command}`)
} } })
function Harness() {
  const [language, setLanguage] = useState<'zh' | 'en'>('en')
  const [access, setAccess] = useState(false)
  const [result, setResult] = useState('Ready')
  const [selectedMode, setMode] = useState(mode)
  const [pending, setPending] = useState(false)
  const reset = () => { listCalls = 0; commitCalls = 0; revokeCalls = 0; audit = []; records = [{ grant: makeGrant(['synthetic/Alpha']), status: mode === 'stale' ? 'stale' : mode === 'inactive' ? 'inactive' : 'active' }] }
  async function openPicker() {
    reset(); setResult('Pending')
    if (mode === 'async-disabled') {
      setPending(true)
      const client = createBoardSelectionClient({ id, version: '1.0.0', name: 'Synthetic reader', permission: true, desktop: true,
        assertActive() {}, onDispose() {}, open: boardPicker.open, captureFocus: captureLibraryFocus,
        invoke: async (command, args) => {
          if (command === 'board_selection_begin') { await delay(); return { ...(args.request as object), handle: 'a'.repeat(64) } }
          if (command === 'board_selection_commit') return makeGrant(['synthetic/Alpha'])
          if (command === 'board_selection_cancel') await delay()
        },
      })
      try { setResult(JSON.stringify(await client.board.requestSelection({ purpose: 'Verify focus across asynchronous issuance.', operations: ['attachDelivery'] }))) }
      finally { await client.dispose(); await delay(); setPending(false) }
      return
    }
    const controller = new AbortController()
    if (mode === 'abort') setTimeout(() => controller.abort(), 2500)
    try {
      const value = await boardPicker.open({ selectionId: crypto.randomUUID(), capabilityId: id, version: '1.0.0', name: 'Synthetic reader', purpose: 'Attach reviewed synthetic meeting notes.', limit: 1, signal: controller.signal, confirm: async items => {
        audit.push(`commit:${JSON.stringify(items)}`); commitCalls++
        if (mode === 'commit-loading') await delay()
        if (mode === 'commit-error' && commitCalls === 1) throw new Error('OUTCOME_UNKNOWN: synthetic commit reply lost')
        return makeGrant(items.map(item => item.id))
      } })
      setResult(JSON.stringify({ result: value, audit }, null, 2))
    } catch (error) { setResult(`${String(error)}\n${JSON.stringify(audit)}`) }
  }
  return <main style={{ padding: 24, height: '100%', overflow: 'auto', background: 'var(--bg)' }}>
    <h1>Task selection UI verification</h1><p>SIMULATED NATIVE SERVICES — synthetic data only. This does not prove desktop authority.</p>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, margin: '20px 0' }}>
      <label>Language <select value={language} onChange={event => { const next = event.target.value as 'en' | 'zh'; document.documentElement.lang = next; setLanguage(next) }}><option value="en">English</option><option value="zh">中文</option></select></label>
      <label>Theme <select onChange={event => { document.documentElement.dataset.theme = event.target.value }}><option value="light">Light</option><option value="dark">Dark</option></select></label>
      <label>Scenario <select value={selectedMode} onChange={event => { mode = event.target.value; setMode(mode) }}>{['success','empty','loading','list-error','commit-loading','commit-error','revoke-error','abort','async-disabled','same-title','stale','inactive'].map(value => <option key={value}>{value}</option>)}</select></label>
      <button className="primary-button" disabled={pending} onClick={() => void openPicker()}>Open picker</button>
      <button className="secondary-button" onClick={() => { reset(); setAccess(true) }}>Open access manager</button>
    </div>
    <pre aria-label="Fixture result" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{result}</pre>
    <TaskSelectionDialog language={language} />
    {access && <TaskAccessDialog language={language} onClose={() => { setAccess(false); setResult(JSON.stringify({ records, audit }, null, 2)) }} />}
  </main>
}
createRoot(document.getElementById('root')!).render(<Harness />)
