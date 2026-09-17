import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckIcon, Cross2Icon, GlobeIcon, Pencil2Icon, PlusIcon, TrashIcon } from '@radix-ui/react-icons'
import {
  isDesktopHost,
  listCompatibleEndpoints,
  removeCompatibleEndpoint,
  saveCompatibleEndpoint,
  selectCompatibleEndpoint,
  type CompatibleEndpoint,
  type CompatibleEndpoints,
  type WireApi,
} from './platform'
import type { Language } from './i18n'

const EMPTY: CompatibleEndpoints = { endpoints: [], selectedId: '' }

type CredentialMode = 'stored' | 'environment'

type FormState = {
  id: string
  label: string
  baseUrl: string
  model: string
  wireApi: WireApi
  credential: CredentialMode
  apiKey: string
  apiKeyEnv: string
  reasoningEffort: string
}

const BLANK_FORM: FormState = {
  id: '',
  label: '',
  baseUrl: '',
  model: '',
  wireApi: 'chat',
  credential: 'stored',
  apiKey: '',
  apiKeyEnv: '',
  reasoningEffort: '',
}

function editForm(endpoint: CompatibleEndpoint): FormState {
  return {
    id: endpoint.id,
    label: endpoint.label,
    baseUrl: endpoint.baseUrl,
    model: endpoint.model,
    wireApi: endpoint.wireApi,
    credential: endpoint.credential === 'environment' ? 'environment' : 'stored',
    apiKey: '',
    apiKeyEnv: endpoint.apiKeyEnv,
    reasoningEffort: endpoint.reasoningEffort,
  }
}

/**
 * Lets a person connect their own model endpoints. Keys are submitted to the
 * desktop host and never read back, so the form only ever shows a masked hint.
 */
export function CompatibleEndpointSettings({ language, onNotice, onChanged }: { language: Language; onNotice: (message: string) => void; onChanged: () => void }) {
  const { t } = useTranslation()
  const [state, setState] = useState<CompatibleEndpoints>(EMPTY)
  const [form, setForm] = useState<FormState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmingId, setConfirmingId] = useState('')
  const desktop = isDesktopHost()

  useEffect(() => {
    if (!desktop) return
    let current = true
    void listCompatibleEndpoints()
      .then((value) => { if (current) setState(value) })
      .catch(() => { if (current) setError(t('endpointsLoadFailed')) })
    return () => { current = false }
  }, [desktop, t])

  const wireLabels = useMemo<Record<WireApi, string>>(() => ({
    responses: t('wireResponses'),
    chat: t('wireChat'),
    anthropic: t('wireAnthropic'),
  }), [t])

  const run = async (action: () => Promise<CompatibleEndpoints>, message: string, afterward?: () => void) => {
    setBusy(true)
    try {
      setState(await action())
      setError('')
      onNotice(message)
      onChanged()
      afterward?.()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  const submit = () => {
    if (!form) return
    void run(
      () => saveCompatibleEndpoint({
        id: form.id || undefined,
        label: form.label,
        baseUrl: form.baseUrl,
        model: form.model,
        wireApi: form.wireApi,
        apiKeyEnv: form.credential === 'environment' ? form.apiKeyEnv : '',
        apiKey: form.credential === 'stored' ? form.apiKey : '',
        reasoningEffort: form.wireApi === 'responses' ? form.reasoningEffort : '',
      }, language),
      t('endpointSaved'),
      () => setForm(null),
    )
  }

  if (!desktop) return <p className="endpoint-preview-note">{t('endpointsPreview')}</p>

  const editingExisting = Boolean(form?.id)

  return (
    <div className="endpoint-panel">
      <div className="endpoint-panel-heading">
        <strong>{t('endpointsTitle')}</strong>
        {!form && <button className="quiet-button" onClick={() => { setForm(BLANK_FORM); setError('') }}>{t('addEndpoint')}<PlusIcon /></button>}
      </div>

      {state.endpoints.length > 0 && <ul className="endpoint-list">
        {state.endpoints.map((endpoint) => (
          <li key={endpoint.id} className={`endpoint-item ${endpoint.selected ? 'selected' : ''}`}>
            <button
              className="endpoint-choose"
              aria-pressed={endpoint.selected}
              disabled={busy}
              onClick={() => { if (!endpoint.selected) void run(() => selectCompatibleEndpoint(endpoint.id, language), t('endpointSelected')) }}
            >
              <span className="endpoint-choose-icon">{endpoint.selected ? <CheckIcon /> : <GlobeIcon />}</span>
              <span className="endpoint-choose-copy">
                <strong>{endpoint.label}{endpoint.selected && <em>{t('endpointInUse')}</em>}</strong>
                <span>{endpoint.model} · {wireLabels[endpoint.wireApi]}</span>
                <small className={endpoint.credential === 'missing' ? 'endpoint-credential-missing' : ''}>
                  {endpoint.credential === 'environment' ? `${t('credentialEnvironment')} · ${endpoint.credentialHint}`
                    : endpoint.credential === 'stored' ? `${t('credentialStored')} · ${endpoint.credentialHint}`
                    : endpoint.credential === 'local' ? t('credentialLocal')
                    : t('credentialMissing')}
                </small>
              </span>
            </button>
            <div className="endpoint-item-actions">
              <button className="icon-button" aria-label={t('endpointEdit')} disabled={busy} onClick={() => { setForm(editForm(endpoint)); setConfirmingId(''); setError('') }}><Pencil2Icon /></button>
              {confirmingId === endpoint.id
                ? <button className="text-button endpoint-confirm" disabled={busy} onClick={() => void run(() => removeCompatibleEndpoint(endpoint.id, language), t('endpointRemoved'), () => { setConfirmingId(''); setForm((current) => current?.id === endpoint.id ? null : current) })}>{t('endpointRemoveConfirm')}</button>
                : <button className="icon-button" aria-label={t('endpointRemove')} disabled={busy} onClick={() => setConfirmingId(endpoint.id)}><TrashIcon /></button>}
            </div>
          </li>
        ))}
      </ul>}


      {form && <form className="endpoint-form" onSubmit={(event) => { event.preventDefault(); submit() }}>
        <div className="endpoint-form-grid">
          <label className="endpoint-field">{t('endpointLabel')}
            <input autoFocus value={form.label} maxLength={60} disabled={busy} onChange={(event) => setForm({ ...form, label: event.target.value })} />
          </label>
          <label className="endpoint-field">{t('endpointModel')}
            <input value={form.model} spellCheck={false} disabled={busy} onChange={(event) => setForm({ ...form, model: event.target.value })} />
          </label>
          <label className="endpoint-field endpoint-field-wide">{t('endpointBaseUrl')}
            <input value={form.baseUrl} spellCheck={false} disabled={busy} onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} />
          </label>
          <div className="endpoint-field" role="group" aria-label={t('endpointWireApi')}><span>{t('endpointWireApi')}</span>
            <div className="endpoint-choices">
              {(['responses', 'chat', 'anthropic'] as WireApi[]).map((wire) => (
                <button key={wire} type="button" className={form.wireApi === wire ? 'is-active' : ''} aria-pressed={form.wireApi === wire} disabled={busy} onClick={() => setForm({ ...form, wireApi: wire })}>{wireLabels[wire]}</button>
              ))}
            </div>
          </div>
          <div className="endpoint-field" role="group" aria-label={t('endpointCredential')}><span>{t('endpointCredential')}</span>
            <div className="endpoint-choices">
              {(['stored', 'environment'] as CredentialMode[]).map((mode) => (
                <button key={mode} type="button" className={form.credential === mode ? 'is-active' : ''} aria-pressed={form.credential === mode} disabled={busy} onClick={() => setForm({ ...form, credential: mode })}>{mode === 'stored' ? t('credentialStored') : t('credentialEnvironment')}</button>
              ))}
            </div>
          </div>
          {form.credential === 'stored'
            ? <label className="endpoint-field">{t('endpointApiKey')}
                <input type="password" value={form.apiKey} autoComplete="off" spellCheck={false} placeholder={editingExisting ? t('credentialKeep') : ''} disabled={busy} onChange={(event) => setForm({ ...form, apiKey: event.target.value })} />
              </label>
            : <label className="endpoint-field">{t('endpointApiKeyEnv')}
                <input value={form.apiKeyEnv} spellCheck={false} disabled={busy} onChange={(event) => setForm({ ...form, apiKeyEnv: event.target.value })} />
              </label>}
          {form.wireApi === 'responses' && <label className="endpoint-field">{t('endpointReasoning')}
            <input value={form.reasoningEffort} spellCheck={false} disabled={busy} onChange={(event) => setForm({ ...form, reasoningEffort: event.target.value })} />
          </label>}
        </div>
        <div className="endpoint-form-actions">
          <button type="button" className="quiet-button" disabled={busy} onClick={() => { setForm(null); setError('') }}>{t('endpointCancel')}<Cross2Icon /></button>
          <button type="submit" className="primary-button" disabled={busy || !form.baseUrl.trim() || !form.model.trim()}>{busy ? t('endpointSaving') : t('endpointSave')}</button>
        </div>
      </form>}

      {error && <p role="alert" className="endpoint-error">{error}</p>}
    </div>
  )
}
