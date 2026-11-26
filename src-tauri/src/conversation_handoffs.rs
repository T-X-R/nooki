//! User-owned draft offers, not Agent sessions or a capability authorization endpoint.
//! The host controller must validate approval/installation in `authorize`, which runs under the
//! data and authority fences. Source capture runs only for a new effect under those same fences.
use crate::document_grants::{DocumentReference, SelectedDocument};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::{BTreeMap, BTreeSet}, fs, io::{Read, Write}, path::Path};

const FILE: &str = "conversation-handoffs.json";
const MAX_BYTES: usize = 12_000_000;
const MAX_CONTENT: usize = 8_000_000;
const MAX_DRAFTS: usize = 256;

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum Target { New, Conversation { id: String } }
#[derive(Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ApprovedDraft { pub title: String, pub text: String, pub target: Target, pub sources: Vec<DocumentReference> }
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Receipt { pub draft_id: String, pub target: Target }
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Draft {
    pub id: String, pub title: String, pub text: String, pub target: Target,
    pub documents: Vec<SelectedDocument>, pub capability_id: String,
    pub capability_version: String, pub created_at: String,
}
impl Draft {
    fn input(&self)->ApprovedDraft {
        ApprovedDraft {title:self.title.clone(),text:self.text.clone(),target:self.target.clone(),sources:self.documents.iter().map(|d|d.reference.clone()).collect()}
    }
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredReceipt { capability_id: String, input_hash: String, result: Receipt }
#[derive(Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Ledger { drafts: BTreeMap<String, Draft>, receipts: BTreeMap<String, StoredReceipt> }
fn hash(value: &impl Serialize) -> Result<String, String> { Ok(format!("{:x}", Sha256::digest(serde_json::to_vec(value).map_err(|e| e.to_string())?))) }
fn hex(value: &str) -> bool { value.len() == 64 && value.bytes().all(|b| b.is_ascii_hexdigit()) }
pub(crate) fn target_valid(target: &Target) -> bool { match target { Target::New => true, Target::Conversation { id } => !id.is_empty() && id.len() <= 256 && !id.chars().any(char::is_control) } }
fn identity_valid(id: &str) -> bool { !id.is_empty() && id.len() <= 256 && !id.chars().any(char::is_control) }
pub(crate) fn input_valid(input: &ApprovedDraft) -> bool {
    let mut ids = BTreeSet::new();
    !input.title.trim().is_empty() && input.title.chars().count() <= 120
        && !input.text.trim().is_empty() && input.text.chars().count() <= 20_000 && !input.text.contains('\0')
        && target_valid(&input.target) && input.sources.len() <= 50
        && input.sources.iter().all(|r| r.kind == "library-document" && crate::document_library::validate_id(&r.document_id).is_ok()
            && !r.title.trim().is_empty() && r.title.chars().count() <= 120 && identity_valid(&r.revision)
            && !r.grant_id.is_empty() && r.grant_id.len() <= 100 && r.grant_id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
            && ids.insert(&r.document_id))
}
fn validate(ledger: &Ledger) -> Result<(), String> {
    if ledger.drafts.len() > MAX_DRAFTS || ledger.receipts.len() != ledger.drafts.len() { return Err("RESOURCE_LIMIT: invalid handoff draft capacity".into()); }
    let mut bytes = 0usize;
    for (id, draft) in &ledger.drafts {
        let input = draft.input();
        if !hex(id) || id != &draft.id || !input_valid(&input) || !identity_valid(&draft.capability_id)
            || semver::Version::parse(&draft.capability_version).is_err() || chrono::DateTime::parse_from_rfc3339(&draft.created_at).is_err()
            || draft.documents.iter().any(|d| d.content.is_none() || d.document_date.len() > 100) { return Err("Invalid retained handoff draft".into()); }
        bytes += draft.text.len() + draft.documents.iter().map(|d| d.content.as_ref().unwrap().len()).sum::<usize>();
    }
    if bytes > MAX_CONTENT { return Err("RESOURCE_LIMIT: retained handoff content exceeds 8 MB".into()); }
    let mut referenced = BTreeSet::new();
    for (key, receipt) in &ledger.receipts {
        let draft = ledger.drafts.get(&receipt.result.draft_id).ok_or("Invalid handoff receipt target")?;
        if !hex(key) || !hex(&receipt.input_hash) || receipt.capability_id != draft.capability_id
            || receipt.result.target != draft.target || !referenced.insert(&receipt.result.draft_id) {
            return Err("Invalid handoff receipt".into());
        }
        let input = draft.input();
        if hash(&input)? != receipt.input_hash { return Err("Invalid handoff request fingerprint".into()); }
    }
    Ok(())
}
fn decode(bytes: &[u8]) -> Result<Ledger, String> {
    if bytes.len() > MAX_BYTES { return Err("RESOURCE_LIMIT: handoff store exceeds 12 MB".into()); }
    let ledger: Ledger = serde_json::from_slice(bytes).map_err(|_| "Invalid handoff store")?;
    validate(&ledger)?; Ok(ledger)
}
pub(crate) fn validate_backup(content: &str) -> Result<(), String> { decode(content.as_bytes()).map(|_| ()) }
fn load(root: &Path) -> Result<Ledger, String> {
    let file = match fs::File::open(root.join(FILE)) { Ok(file) => file, Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Ledger::default()), Err(e) => return Err(e.to_string()) };
    let mut bytes = Vec::new(); file.take((MAX_BYTES+1) as u64).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    decode(&bytes)
}
fn confirm(root: &Path) -> Result<(), String> {
    fs::File::open(root.join(FILE)).and_then(|file| file.sync_all())
        .and_then(|_| fs::File::open(root)?.sync_all()).map_err(|_| "OUTCOME_UNKNOWN: handoff durability is uncertain".into())
}
fn save(root: &Path, ledger: &Ledger) -> Result<(), String> {
    validate(ledger)?;
    let bytes = serde_json::to_vec(ledger).map_err(|e| e.to_string())?;
    if bytes.len() > MAX_BYTES { return Err("RESOURCE_LIMIT: handoff store exceeds 12 MB".into()); }
    let pending = root.join("conversation-handoffs.pending");
    let mut file = fs::File::create(&pending).map_err(|e| e.to_string())?;
    file.write_all(&bytes).and_then(|_| file.sync_all()).map_err(|e| e.to_string())?;
    fs::rename(&pending, root.join(FILE)).map_err(|e| e.to_string())?;
    confirm(root)
}

/// Internal effect owner. The authorization callback must check host-approved target/intent and
/// current installation on every call, including replay; it must not acquire the data/fence locks.
/// The capture callback must return exact selected snapshots, never package-supplied document text.
/// No Tauri command or public SDK method calls this storage layer until C05b supplies that controller.
pub fn commit_approved(root: &Path, capability_id: &str, capability_version: &str, key: &str,
    input: &ApprovedDraft, authorize: impl FnOnce() -> Result<(), String>,
    capture: impl FnOnce() -> Result<Vec<SelectedDocument>, String>) -> Result<Receipt, String> {
    if !identity_valid(capability_id) || semver::Version::parse(capability_version).is_err()
        || key.is_empty() || key.len() > 128 || key.chars().any(char::is_control) || !input_valid(input) {
        return Err("INVALID_INPUT: invalid approved handoff".into());
    }
    let _data = crate::task_worker::data_lock(root)?.ok_or("RESOURCE_BUSY: user data is changing")?;
    crate::user_data::ensure_restore_complete(root)?;
    let _authority = crate::capability_authority::fence(root)?;
    authorize()?;
    let mut ledger = load(root)?;
    let key = hash(&(capability_id, "conversations.handoff", key))?;
    let input_hash = hash(input)?;
    if let Some(receipt) = ledger.receipts.get(&key) {
        if receipt.input_hash != input_hash { return Err("CONFLICT: handoff key was used with different input or target".into()); }
        confirm(root)?; return Ok(receipt.result.clone());
    }
    if ledger.drafts.len() >= MAX_DRAFTS { return Err("RESOURCE_LIMIT: handoff drafts are full; existing drafts are retained".into()); }
    let documents = capture()?;
    if documents.len() != input.sources.len() || documents.iter().zip(&input.sources).any(|(d,r)| &d.reference != r || d.content.is_none()) {
        return Err("PERMISSION_DENIED: captured sources differ from approved handoff".into());
    }
    let id = crate::capability_authority::nonce()?;
    if ledger.drafts.contains_key(&id) { return Err("RESOURCE_UNAVAILABLE: handoff identity collision".into()); }
    let result = Receipt { draft_id:id.clone(),target:input.target.clone() };
    ledger.drafts.insert(id.clone(), Draft { id,title:input.title.clone(),text:input.text.clone(),target:input.target.clone(),documents,
        capability_id:capability_id.into(),capability_version:capability_version.into(),created_at:chrono::Local::now().to_rfc3339() });
    ledger.receipts.insert(key, StoredReceipt { capability_id:capability_id.into(),input_hash,result:result.clone() });
    save(root, &ledger)?; Ok(result)
}
/// Host user-data reads only. A draft ID is not a package read grant.
pub fn list(root: &Path) -> Result<Vec<Draft>, String> {
    let _data = crate::task_worker::data_lock(root)?.ok_or("RESOURCE_BUSY: user data is changing")?;
    crate::user_data::ensure_restore_complete(root)?;
    Ok(load(root)?.drafts.into_values().collect())
}
pub fn read(root: &Path, id: &str) -> Result<Draft, String> {
    list(root)?.into_iter().find(|draft| draft.id == id).ok_or("NOT_FOUND: handoff draft unavailable".into())
}

// Caller holds task-data and authority fences. Return only the original approved request/receipt;
// callers compare proposal content before exposing metadata. No source recapture or navigation.
pub(crate) fn lookup(root:&Path,capability_id:&str,key:&str)->Result<Option<(ApprovedDraft,Receipt)>,String> {
    let ledger=load(root)?;
    let Some(receipt)=ledger.receipts.get(&hash(&(capability_id,"conversations.handoff",key))?) else {return Ok(None)};
    let draft=&ledger.drafts[&receipt.result.draft_id];
    confirm(root)?;
    Ok(Some((draft.input(),receipt.result.clone())))
}
