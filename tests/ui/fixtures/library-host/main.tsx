import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { LibrarySelectionDialog } from '../../../../src/features/library/LibrarySelectionDialog'
import { LibraryAccessDialog } from '../../../../src/features/library/LibraryAccessDialog'
import { libraryPicker } from '../../../../src/platform/library-picker'
import type { DocumentGrant } from '../../../../packages/capability-contract/src'
import '../../../../src/app/global.css'

// Test entry only; never imported by the application. All authority and data here are simulated.
const id = 'org.example.ui-selection'
const docs = ['Alpha', 'Beta'].map(title => ({ id: `synthetic/${title}`, title, capabilityName: 'Synthetic notes', collectionName: 'Fixture', documentDate: '2026-11-20' }))
const makeGrant = (ids: string[]): DocumentGrant => ({ id: 'synthetic-grant', capabilityId: id, capabilityVersion: '1.0.0', createdAt: '2026-11-20T00:00:00Z', purpose: 'Summarize only explicitly selected synthetic documents.', documents: ids.map(documentId => ({ reference: { kind: 'library-document', documentId, title: docs.find(doc => doc.id === documentId)!.title, grantId: 'synthetic-grant', revision: 'fixture' }, documentDate: '2026-11-20' })) })
let mode = 'success', listCalls = 0, commitCalls = 0, revokeCalls = 0
let records: { grant: DocumentGrant; status: 'active' | 'revoked' }[] = [{ grant: makeGrant(['synthetic/Alpha']), status: 'active' }]
let audit: string[] = []
const delay = () => new Promise(resolve => setTimeout(resolve, 2500))
Object.assign(window, { __TAURI_INTERNALS__: { invoke: async (command: string) => {
  audit.push(command)
  if (command === 'library_list_documents' || command === 'library_document_access') {
    listCalls++
    if (mode === 'loading') await delay()
    if (mode === 'list-error' && listCalls === 1) throw new Error('Synthetic listing failure')
    if (mode === 'empty') return []
    return command === 'library_list_documents' ? docs : structuredClone(records)
  }
  if (command === 'library_revoke_document_access') {
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
  const reset = () => { listCalls = 0; commitCalls = 0; revokeCalls = 0; audit = []; records = [{ grant: makeGrant(['synthetic/Alpha']), status: 'active' }] }
  async function openPicker() {
    reset(); setResult('Pending')
    const controller = new AbortController()
    if (mode === 'abort') setTimeout(() => controller.abort(), 2500)
    try {
      const value = await libraryPicker.open({ selectionId: crypto.randomUUID(), capabilityId: id, version: '1.0.0', name: 'Synthetic reader', purpose: 'Summarize only explicitly selected synthetic documents.', limit: 1, signal: controller.signal, confirm: async ids => {
        audit.push(`commit:${ids.join(',')}`); commitCalls++
        if (mode === 'commit-error' && commitCalls === 1) throw new Error('OUTCOME_UNKNOWN: synthetic commit reply lost')
        return makeGrant(ids)
      } })
      setResult(JSON.stringify({ result: value, audit }, null, 2))
    } catch (error) { setResult(`${String(error)}\n${JSON.stringify(audit)}`) }
  }
  return <main style={{ padding: 24, height: '100%', overflow: 'auto', background: 'var(--bg)' }}>
    <h1>Library Host UI verification</h1><p>SIMULATED NATIVE SERVICES — synthetic data only. This does not prove desktop authority.</p>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, margin: '20px 0' }}>
      <label>Language <select value={language} onChange={event => { const next = event.target.value as 'en' | 'zh'; document.documentElement.lang = next; setLanguage(next) }}><option value="en">English</option><option value="zh">中文</option></select></label>
      <label>Theme <select onChange={event => { document.documentElement.dataset.theme = event.target.value }}><option value="light">Light</option><option value="dark">Dark</option></select></label>
      <label>Scenario <select value={selectedMode} onChange={event => { mode = event.target.value; setMode(mode) }}>{['success','empty','loading','list-error','commit-error','revoke-error','abort'].map(value => <option key={value}>{value}</option>)}</select></label>
      <button className="primary-button" onClick={() => void openPicker()}>Open picker</button>
      <button className="secondary-button" onClick={() => { reset(); setAccess(true) }}>Open access manager</button>
    </div>
    <pre aria-label="Fixture result" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{result}</pre>
    <LibrarySelectionDialog language={language} />
    {access && <LibraryAccessDialog language={language} names={new Map([[id, 'Synthetic reader']])} onClose={() => { setAccess(false); setResult(JSON.stringify({ records, audit }, null, 2)) }} />}
  </main>
}
createRoot(document.getElementById('root')!).render(<Harness />)
