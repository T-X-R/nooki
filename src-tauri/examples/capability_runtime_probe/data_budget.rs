use std::{collections::{BTreeMap, HashSet}, fs::{self, File}, io::{Read, Write}, path::{Path, PathBuf}};

pub const MIB: u64 = 1024 * 1024;
pub const CHUNK: usize = 64 * 1024;
pub const ARCHIVE_BYTES: u64 = 32 * MIB;
pub const ENTRY_BYTES: u64 = 16 * MIB;
pub const EXPANDED_BYTES: u64 = 64 * MIB;
pub const ENTRIES: usize = 256;

pub fn inspect(file: File) -> Result<u64, String> {
    if file.metadata().map_err(error)?.len() > ARCHIVE_BYTES { return Err("archive bytes exceeded".into()); }
    let mut zip = zip::ZipArchive::new(file).map_err(error)?;
    if zip.len() > ENTRIES { return Err("entry count exceeded".into()); }
    let mut names = HashSet::new();
    let mut total = 0u64;
    let mut buffer = [0; CHUNK];
    for index in 0..zip.len() {
        let entry = zip.by_index(index).map_err(error)?;
        let name = entry.name();
        if name.len() > 1024 || name.contains(['\\', ':'])
            || name.split('/').any(|part| matches!(part, "" | "." | ".."))
            || entry.is_dir() || entry.unix_mode().is_some_and(|mode| mode & 0o170000 == 0o120000)
            || !names.insert(name.to_owned()) { return Err("invalid archive path or duplicate".into()); }
        if entry.size() > ENTRY_BYTES { return Err("entry bytes exceeded".into()); }
        if entry.size() > EXPANDED_BYTES - total { return Err("expanded bytes exceeded".into()); }
        let mut read = entry.take(ENTRY_BYTES + 1);
        let mut entry_bytes = 0u64;
        loop {
            let count = read.read(&mut buffer).map_err(error)?;
            if count == 0 { break; }
            entry_bytes += count as u64;
            if entry_bytes > ENTRY_BYTES { return Err("entry bytes exceeded".into()); }
            if count as u64 > EXPANDED_BYTES - total { return Err("expanded bytes exceeded".into()); }
            total += count as u64;
        }
    }
    Ok(total)
}

// A fresh single-writer fixture directory. Production persistence, authorization,
// concurrent reservations and crash recovery belong to the owning runtime tasks.
pub struct Store {
    root: PathBuf,
    item_bytes: u64,
    total_bytes: u64,
    max_items: usize,
    sizes: BTreeMap<String, u64>,
    used: u64,
}
pub struct Transfer<'a> {
    store: &'a mut Store,
    key: String,
    file: Option<File>,
    expected: u64,
    written: u64,
    failed: bool,
}
impl Store {
    pub fn new(root: &Path, item_bytes: u64, total_bytes: u64, max_items: usize) -> Self {
        fs::create_dir(root).expect("fresh synthetic fixture directory");
        Self { root: root.into(), item_bytes, total_bytes, max_items, sizes: BTreeMap::new(), used: 0 }
    }
    pub fn begin(&mut self, key: &str, bytes: u64) -> Result<Transfer<'_>, String> {
        if key.is_empty() || key.len() > 64 || !key.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_') { return Err("invalid key".into()); }
        if bytes > self.item_bytes { return Err("item bytes exceeded".into()); }
        if !self.sizes.contains_key(key) && self.sizes.len() >= self.max_items { return Err("item count exceeded".into()); }
        // Include the old file while staging its replacement; net-size accounting
        // would exceed the retained-plus-staged content budget before rename.
        if bytes > self.total_bytes - self.used { return Err("store bytes exceeded; free space before writing".into()); }
        let file = File::options().write(true).create_new(true).open(self.root.join(".pending")).map_err(error)?;
        Ok(Transfer { store: self, key: key.into(), file: Some(file), expected: bytes, written: 0, failed: false })
    }
    pub fn remove(&mut self, key: &str) -> Result<(), String> {
        let bytes = *self.sizes.get(key).ok_or("unknown key")?;
        fs::remove_file(self.root.join(key)).map_err(error)?;
        self.sizes.remove(key);
        self.used -= bytes;
        Ok(())
    }
    pub fn usage(&self) -> (usize, u64) { (self.sizes.len(), self.used) }
}
impl Transfer<'_> {
    pub fn write(&mut self, bytes: &[u8]) -> Result<(), String> {
        if self.failed { return Err("transfer failed; cancel and restart".into()); }
        if bytes.len() > CHUNK || bytes.len() as u64 > self.expected - self.written {
            self.failed = true;
            return Err("chunk or declared bytes exceeded".into());
        }
        if let Err(err) = self.file.as_mut().unwrap().write_all(bytes) {
            self.failed = true;
            return Err(error(err));
        }
        self.written += bytes.len() as u64;
        Ok(())
    }
    pub fn commit(mut self) -> Result<(), String> {
        if self.failed || self.written != self.expected { return Err("transfer incomplete or failed".into()); }
        let file = self.file.take().unwrap();
        file.sync_all().map_err(error)?;
        drop(file);
        fs::rename(self.store.root.join(".pending"), self.store.root.join(&self.key)).map_err(error)?;
        let old = self.store.sizes.insert(self.key.clone(), self.written).unwrap_or(0);
        self.store.used = self.store.used - old + self.written;
        Ok(())
    }
}
impl Drop for Transfer<'_> {
    fn drop(&mut self) {
        drop(self.file.take());
        // Best-effort rollback on ordinary errors/drop, not a crash-recovery promise.
        let _ = fs::remove_file(self.store.root.join(".pending"));
    }
}
fn error(err: impl std::fmt::Display) -> String { err.to_string() }
