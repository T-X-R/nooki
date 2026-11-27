//! Internal execution journal, not a package endpoint or an Agent runner.
//! Native controllers supply and revalidate Host authority under the shared lifecycle fences.
use crate::{capability_authority::InvocationContext, document_grants::{DocumentReference, SelectedDocument}};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::{BTreeMap, BTreeSet}, fs, io::{Read, Write}, path::Path};

const FILE: &str = "capability-agent-runs.json";
const MAX_BYTES: usize = 12_000_000;
// Full selected-document allowance plus one maximum UTF-8 instruction, still journal-bounded.
const MAX_DOCUMENT_CONTENT: usize = 8_000_000;
const MAX_CONTENT: usize = MAX_DOCUMENT_CONTENT + 20_000 * 4;
const MAX_RUNS: usize = 256;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct Scope {pub installation: InvocationContext, pub restore_id: Option<String>}
/// Supplied by the verified native adapter, never the package proposal.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct ComponentIdentity {pub protocol_revision: u32, pub sha256: String}
#[derive(Debug, Clone)]
pub struct ResolvedPolicy {pub digest: String, pub component: ComponentIdentity}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct Intent {
    pub instructions: String, pub sources: Vec<DocumentReference>, pub agent_id: String,
    /// Digest of the complete Host-selected policy, not a package-defined profile name.
    pub policy_digest: String, pub output_schema: Option<serde_json::Value>,
    /// Missing only on pre-binding historical records, which cannot acquire new execution authority.
    #[serde(default, skip_serializing_if="Option::is_none")]
    pub component: Option<ComponentIdentity>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag="state", rename_all="camelCase", deny_unknown_fields)]
pub enum Submission {
    Approved,
    /// A submission may have reached the adapter. Only reconciliation may resolve this state.
    Pending {#[serde(rename="clientMessageId")] client_message_id: String},
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct NativeIdentity {pub thread_id: String, pub turn_id: Option<String>}
/// Only a confirmed native terminal turn produces an outcome. A disconnected transport remains
/// pending until the same native turn can be observed; it is not a retryable failure.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag="status", rename_all="camelCase", deny_unknown_fields)]
pub enum Outcome {Completed {text:String}, Failed, Cancelled}
fn outcome_valid(outcome:&Outcome)->bool {
    match outcome {Outcome::Completed{text}=>!text.trim().is_empty() && text.len()<=1_000_000,_=>true}
}
/// Private correlation envelope. Matching this value is necessary, not proof of native provenance.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct NativeRunBinding {
    pub run_id: String, pub scope: Scope, pub approval_id: String, pub client_message_id: String,
    pub input_digest: String, pub policy_digest: String, pub component: ComponentIdentity,
}
/// Native-owner transport material. Contains retained source bodies; never expose or log it.
#[derive(Clone, Serialize)]
#[serde(rename_all="camelCase")]
pub struct NativeLaunchInput {pub binding: NativeRunBinding, pub input_json: String}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct Run {
    pub id: String, pub scope: Scope, pub intent: Intent, pub documents: Vec<SelectedDocument>,
    pub approval_id: String, pub approved_at: String, pub submission: Submission,
    /// Imported records retain history only, even if an archive forged a matching restore scope.
    pub restored: bool,
    #[serde(default, skip_serializing_if="Option::is_none")]
    pub native: Option<NativeIdentity>,
    #[serde(default, skip_serializing_if="Option::is_none")]
    pub outcome: Option<Outcome>,
    request_key: String,
}
#[derive(Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Ledger {runs: BTreeMap<String, Run>}
fn hex(s: &str) -> bool {s.len()==64 && s.bytes().all(|b| b.is_ascii_hexdigit())}
fn identity(s: &str) -> bool {!s.trim().is_empty() && s.len()<=256 && !s.chars().any(char::is_control)}
fn key_valid(s: &str) -> bool {identity(s) && s.len()<=128}
fn component_valid(component: &ComponentIdentity) -> bool {component.protocol_revision==1 && hex(&component.sha256)}
fn native_valid(native: &NativeIdentity) -> bool {key_valid(&native.thread_id) && native.turn_id.as_ref().is_none_or(|id|key_valid(id))}
fn hash(value: &impl Serialize) -> Result<String,String> {
    Ok(format!("{:x}",Sha256::digest(serde_json::to_vec(value).map_err(|e|e.to_string())?)))
}
fn scope_valid(scope: &Scope) -> bool {
    identity(&scope.installation.capability_id) && semver::Version::parse(&scope.installation.capability_version).is_ok()
        && hex(&scope.installation.generation) && scope.restore_id.as_ref().is_none_or(|id|
            !id.is_empty() && id.len()<=100 && id.bytes().all(|b|b.is_ascii_alphanumeric()||b==b'-'))
}
pub(crate) fn intent_valid(intent: &Intent) -> bool {
    let mut ids=BTreeSet::new();
    !intent.instructions.trim().is_empty() && intent.instructions.chars().count()<=20_000
        && intent.component.as_ref().is_none_or(component_valid)
        && !intent.instructions.contains('\0') && identity(&intent.agent_id) && hex(&intent.policy_digest)
        && intent.output_schema.as_ref().is_none_or(|schema|schema.is_object()
            && serde_json::to_vec(schema).is_ok_and(|bytes|bytes.len()<=16_384))
        && intent.sources.len()<=50 && intent.sources.iter().all(|r|
            r.kind=="library-document" && crate::document_library::validate_id(&r.document_id).is_ok()
            && !r.title.trim().is_empty() && !r.title.chars().any(char::is_control)
            && r.title.chars().count()<=120 && identity(&r.revision)
            && !r.grant_id.is_empty() && r.grant_id.len()<=100
            && r.grant_id.bytes().all(|b|b.is_ascii_lowercase()||b.is_ascii_digit()||b==b'-')
            && ids.insert(&r.document_id))
}
fn documents_match(run: &Run) -> bool {
    run.documents.len()==run.intent.sources.len() && run.documents.iter().zip(&run.intent.sources)
        .all(|(doc,reference)| &doc.reference==reference && doc.content.is_some() && doc.document_date.len()<=100)
}
fn validate(ledger: &Ledger) -> Result<(),String> {
    if ledger.runs.len()>MAX_RUNS {return Err("RESOURCE_LIMIT: Agent run journal is full".into());}
    let mut keys=BTreeSet::new();let mut approvals=BTreeSet::new();let mut messages=BTreeSet::new();let mut threads=BTreeSet::new();let mut bytes=0usize;
    for (id,run) in &ledger.runs {
        if id!=&run.id || !hex(id) || !scope_valid(&run.scope) || !intent_valid(&run.intent)
            || !key_valid(&run.request_key) || !keys.insert(hash(&(&run.scope,&run.request_key))?)
            || !hex(&run.approval_id) || !approvals.insert(&run.approval_id)
            || chrono::DateTime::parse_from_rfc3339(&run.approved_at).is_err() || !documents_match(run) {
            return Err("RESOURCE_UNAVAILABLE: invalid Agent run journal".into());
        }
        if let Submission::Pending {client_message_id}=&run.submission {
            if !hex(client_message_id) || !messages.insert(client_message_id) {return Err("RESOURCE_UNAVAILABLE: invalid submission identity".into());}
        }
        if let Some(native)=&run.native {
            if !native_valid(native) || run.intent.component.is_none() || run.submission==Submission::Approved || !threads.insert(&native.thread_id) {
                return Err("RESOURCE_UNAVAILABLE: invalid native Agent identity".into());
            }
        }
        if run.outcome.as_ref().is_some_and(|outcome|!outcome_valid(outcome)
            || run.native.as_ref().and_then(|native|native.turn_id.as_ref()).is_none()) {
            return Err("RESOURCE_UNAVAILABLE: invalid Agent result".into());
        }
        let source_bytes=run.documents.iter().map(|d|d.content.as_ref().unwrap().len()).sum::<usize>();
        if source_bytes>MAX_DOCUMENT_CONTENT {return Err("RESOURCE_LIMIT: selected Agent documents exceed 8 MB".into());}
        bytes+=run.intent.instructions.len()+source_bytes;
    }
    if bytes>MAX_CONTENT {return Err("RESOURCE_LIMIT: retained Agent input budget is full".into());} Ok(())
}
fn decode(bytes: &[u8]) -> Result<Ledger,String> {
    if bytes.len()>MAX_BYTES {return Err("RESOURCE_LIMIT: Agent run journal exceeds 12 MB".into());}
    let ledger=serde_json::from_slice(bytes).map_err(|_|"RESOURCE_UNAVAILABLE: invalid Agent run journal")?;
    validate(&ledger)?; Ok(ledger)
}
pub(crate) fn validate_backup(content: &str) -> Result<(),String> {decode(content.as_bytes()).map(|_|())}
/// Called on the restore staging tree, before it can replace live data. Never trusts imported
/// execution eligibility. Preserve submission identity for later Host audit/reconciliation.
pub(crate) fn mark_restored(root: &Path) -> Result<(),String> {
    if !root.join(FILE).try_exists().map_err(|e|e.to_string())? {return Ok(());}
    let mut ledger=load(root)?;
    for run in ledger.runs.values_mut() {run.restored=true;}
    save(root,&ledger)
}
fn load(root: &Path) -> Result<Ledger,String> {
    let file=match fs::File::open(root.join(FILE)) {
        Ok(file)=>file, Err(e) if e.kind()==std::io::ErrorKind::NotFound=>return Ok(Ledger::default()), Err(e)=>return Err(e.to_string()),
    };
    let mut bytes=Vec::new();file.take((MAX_BYTES+1) as u64).read_to_end(&mut bytes).map_err(|e|e.to_string())?;decode(&bytes)
}
fn confirm(root: &Path) -> Result<(),String> {
    fs::File::open(root.join(FILE)).and_then(|file|file.sync_all()).and_then(|_|fs::File::open(root)?.sync_all())
        .map_err(|_|"OUTCOME_UNKNOWN: Agent run journal durability is uncertain".into())
}
fn save(root: &Path, ledger: &Ledger) -> Result<(),String> {
    validate(ledger)?;
    let bytes=serde_json::to_vec(ledger).map_err(|e|e.to_string())?;
    if bytes.len()>MAX_BYTES {return Err("RESOURCE_LIMIT: Agent run journal exceeds 12 MB".into());}
    let pending=root.join("capability-agent-runs.pending");
    let mut options=fs::OpenOptions::new();options.create(true).truncate(true).write(true);
    #[cfg(unix)] {use std::os::unix::fs::OpenOptionsExt;options.mode(0o600);}
    let mut file=options.open(&pending).map_err(|e|e.to_string())?;
    file.write_all(&bytes).and_then(|_|file.sync_all()).map_err(|e|e.to_string())?;
    fs::rename(&pending,root.join(FILE)).map_err(|e|e.to_string())?;confirm(root)
}
// Lock order matches capability effect owners and restore. The authorization callback must not
// acquire these locks or await IPC; it rechecks current installation and Host-approved scope.
fn fenced<T>(root: &Path, scope: &Scope, authorize: impl FnOnce()->Result<(),String>,
    effect: impl FnOnce()->Result<T,String>) -> Result<T,String> {
    if !scope_valid(scope) {return Err("INVALID_INPUT: invalid Agent run scope".into());}
    let _data=crate::task_worker::data_lock(root)?.ok_or("RESOURCE_BUSY: user data is changing")?;
    crate::user_data::ensure_restore_complete(root)?;
    let _authority=crate::capability_authority::fence(root)?;
    if crate::user_data::restored_id(root)?!=scope.restore_id {return Err("PERMISSION_DENIED: Agent run restore scope changed".into());}
    authorize()?;effect()
}

/// Called only after native Host review. `capture` supplies native immutable selected text.
/// Exact retries revalidate authority but do not recapture or change an approved intent.
pub fn approve(root: &Path, scope: &Scope, key: &str, intent: &Intent,
    authorize: impl FnOnce()->Result<(),String>, capture: impl FnOnce()->Result<Vec<SelectedDocument>,String>) -> Result<Run,String> {
    if !key_valid(key) || !intent_valid(intent) {return Err("INVALID_INPUT: invalid Agent run intent".into());}
    fenced(root,scope,authorize,|| {
        let mut ledger=load(root)?;
        if let Some(run)=ledger.runs.values().find(|run|&run.scope==scope && run.request_key==key) {
            if &run.intent!=intent {return Err("CONFLICT: Agent run key was used with different intent".into());}
            confirm(root)?;return Ok(run.clone());
        }
        if intent.component.is_none() {return Err("UNSUPPORTED_SERVICE: verified native component identity is required".into());}
        if ledger.runs.len()>=MAX_RUNS {return Err("RESOURCE_LIMIT: Agent run journal is full; existing runs are retained".into());}
        let run=Run {id:crate::capability_authority::nonce()?,scope:scope.clone(),intent:intent.clone(),documents:capture()?,
            approval_id:crate::capability_authority::nonce()?,approved_at:chrono::Local::now().to_rfc3339(),submission:Submission::Approved,restored:false,native:None,outcome:None,request_key:key.into()};
        if !documents_match(&run) {return Err("PERMISSION_DENIED: captured sources differ from approved Agent input".into());}
        if ledger.runs.contains_key(&run.id) {return Err("RESOURCE_UNAVAILABLE: Agent run identity collision".into());}
        ledger.runs.insert(run.id.clone(),run.clone());save(root,&ledger)?;Ok(run)
    })
}
fn owned<'a>(ledger: &'a Ledger, scope: &Scope, id: &str) -> Result<&'a Run,String> {
    ledger.runs.get(id).filter(|run|&run.scope==scope).ok_or("PERMISSION_DENIED: Agent run is unavailable for this scope".into())
}
pub fn get(root: &Path, scope: &Scope, id: &str, authorize: impl FnOnce()->Result<(),String>) -> Result<Run,String> {
    fenced(root,scope,authorize,|| {let ledger=load(root)?;let run=owned(&ledger,scope,id)?;confirm(root)?;Ok(run.clone())})
}
// Controller holds data/authority fences and has checked the current installation. A lookup
// returns retained intent for comparison, never a new approval or submission claim.
pub(crate) fn lookup(root: &Path, scope: &Scope, key: &str) -> Result<Option<Run>,String> {
    let ledger=load(root)?;
    let run=ledger.runs.into_values().find(|run|&run.scope==scope && run.request_key==key);
    if run.is_some() {confirm(root)?;} Ok(run)
}
/// Returns dispatch eligibility only on the first durable transition. A repeated claim must be
/// reconciled using `get`; it never grants a second adapter call, even if the first call never ran.
/// The controller must revalidate source grants and execution authority in `authorize`.
pub fn claim_submission(root: &Path, scope: &Scope, id: &str, authorize: impl FnOnce(&Run)->Result<(),String>) -> Result<Run,String> {
    fenced(root,scope,||Ok(()),|| {
        let mut ledger=load(root)?;let mut run=owned(&ledger,scope,id)?.clone();
        authorize(&run)?;
        if run.restored {return Err("PERMISSION_DENIED: imported Agent history carries no execution authority".into());}
        if run.submission!=Submission::Approved {return Err("OUTCOME_UNKNOWN: reconcile the existing Agent submission before proceeding".into());}
        if run.intent.component.is_none() {return Err("UNSUPPORTED_SERVICE: historical Agent approval has no native component binding".into());}
        run.submission=Submission::Pending {client_message_id:crate::capability_authority::nonce()?};
        ledger.runs.insert(run.id.clone(),run.clone());save(root,&ledger)?;Ok(run)
    })
}

fn input_json(run: &Run) -> Result<String,String> {
    serde_json::to_string(&("nooki-agent-input-v1",&run.intent.instructions,&run.documents,&run.intent.output_schema,&run.intent.agent_id))
        .map_err(|e|e.to_string())
}
fn binding(run: &Run) -> Result<NativeRunBinding,String> {
    if run.restored {return Err("PERMISSION_DENIED: imported Agent history carries no execution authority".into());}
    let Submission::Pending {client_message_id}=&run.submission else {return Err("OUTCOME_UNKNOWN: Agent submission has not been claimed".into());};
    let component=run.intent.component.clone().ok_or("UNSUPPORTED_SERVICE: historical Agent approval has no native component binding")?;
    Ok(NativeRunBinding {run_id:run.id.clone(),scope:run.scope.clone(),approval_id:run.approval_id.clone(),
        client_message_id:client_message_id.clone(),policy_digest:run.intent.policy_digest.clone(),component,
        input_digest:format!("{:x}",Sha256::digest(input_json(run)?.as_bytes()))})
}
/// Reconstruct only from the authoritative journal under its existing fences. Reading a binding
/// does not claim submission again or authorize a resume; the adapter must validate native provenance.
pub fn native_binding(root: &Path, scope: &Scope, id: &str, authorize: impl FnOnce()->Result<(),String>) -> Result<NativeRunBinding,String> {
    fenced(root,scope,authorize,|| {let ledger=load(root)?;let result=binding(owned(&ledger,scope,id)?)?;confirm(root)?;Ok(result)})
}
/// Export exact approved bytes and their binding together under the existing journal fences.
/// This is not a new dispatch claim. Only the native owner may materialize or submit these bytes.
pub fn native_launch_input(root: &Path, scope: &Scope, id: &str, authorize: impl FnOnce()->Result<(),String>) -> Result<NativeLaunchInput,String> {
    fenced(root,scope,authorize,|| {
        let ledger=load(root)?;let run=owned(&ledger,scope,id)?;
        let result=NativeLaunchInput {binding:binding(run)?,input_json:input_json(run)?};confirm(root)?;Ok(result)
    })
}
/// Adapter owner only, after checking the actual component's provenance. Record thread creation
/// and then the observed turn without another dispatch claim. Never replace either identity.
/// Current installation authority is required; changed policy/source grants must not prevent
/// recording an already submitted outcome. This function never authorizes further execution.
pub fn record_native(root: &Path, scope: &Scope, expected: &NativeRunBinding, observed: &NativeIdentity,
    authorize: impl FnOnce()->Result<(),String>) -> Result<Run,String> {
    if !native_valid(observed) {return Err("INVALID_INPUT: invalid native Agent identity".into());}
    fenced(root,scope,authorize,|| {
        let mut ledger=load(root)?;let mut run=owned(&ledger,scope,&expected.run_id)?.clone();
        if binding(&run)?!=*expected {return Err("PERMISSION_DENIED: native Agent binding differs from approved run".into());}
        if ledger.runs.values().any(|other|other.id!=run.id && other.native.as_ref().is_some_and(|n|n.thread_id==observed.thread_id)) {
            return Err("CONFLICT: native Agent thread already belongs to another run".into());
        }
        if let Some(current)=&run.native {
            if current.thread_id!=observed.thread_id || (current.turn_id.is_some() && observed.turn_id.is_some() && current.turn_id!=observed.turn_id) {
                return Err("CONFLICT: native Agent identity changed".into());
            }
            if current.turn_id.is_some() || observed.turn_id.is_none() {confirm(root)?;return Ok(run);}
        }
        run.native=Some(observed.clone());ledger.runs.insert(run.id.clone(),run.clone());save(root,&ledger)?;Ok(run)
    })
}

/// Retain a result from the adapter's already-bound native turn. No source is recaptured and no
/// submission is retried. Replayed notifications/readback are idempotent; terminal results freeze.
pub fn record_outcome(root:&Path,scope:&Scope,expected:&NativeRunBinding,observed:&NativeIdentity,
    outcome:&Outcome,authorize:impl FnOnce()->Result<(),String>)->Result<Run,String> {
    if observed.turn_id.is_none() || !native_valid(observed) || !outcome_valid(outcome) {
        return Err("INVALID_INPUT: invalid native Agent result".into());
    }
    fenced(root,scope,authorize,|| {
        let mut ledger=load(root)?;let mut run=owned(&ledger,scope,&expected.run_id)?.clone();
        if binding(&run)?!=*expected || run.native.as_ref()!=Some(observed) {
            return Err("PERMISSION_DENIED: result does not belong to the bound native turn".into());
        }
        if let Some(retained)=&run.outcome {
            if retained!=outcome {return Err("CONFLICT: native Agent result is already final".into());}
            confirm(root)?;return Ok(run);
        }
        run.outcome=Some(outcome.clone());ledger.runs.insert(run.id.clone(),run.clone());save(root,&ledger)?;Ok(run)
    })
}
