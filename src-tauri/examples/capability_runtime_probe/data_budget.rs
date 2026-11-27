use std::{collections::{BTreeMap, HashSet}, fs::{self, File}, io::{Read, Write}, path::{Path, PathBuf}, sync::{Arc, Mutex}};

pub const MIB: u64 = 1024 * 1024;
pub const CHUNK: usize = 64 * 1024;
pub const ARCHIVE_BYTES: u64 = 32 * MIB;
pub const ENTRY_BYTES: u64 = 16 * MIB;
pub const EXPANDED_BYTES: u64 = 64 * MIB;
pub const ENTRIES: usize = 256;

#[derive(Clone)]
pub struct DiskPool(Arc<Mutex<DiskCounts>>);
struct DiskCounts {
    limits: (u64, usize, usize, usize),
    bytes: u64, files: usize, stores: usize, writers: usize,
}
impl DiskPool {
    pub fn new(bytes: u64, files: usize, stores: usize, writers: usize) -> Self {
        Self(Arc::new(Mutex::new(DiskCounts { limits:(bytes, files, stores, writers), bytes:0, files:0, stores:0, writers:0 })))
    }
    pub fn snapshot(&self) -> serde_json::Value {
        let c = self.0.lock().unwrap();
        serde_json::json!({"bytes":c.bytes,"files":c.files,"stores":c.stores,"writers":c.writers})
    }
    fn reserve(&self, bytes: u64) -> Result<(), String> {
        let mut c = self.0.lock().unwrap();
        if bytes > c.limits.0 - c.bytes { return Err("profile content bytes exceeded; free space before writing".into()); }
        if c.files >= c.limits.1 { return Err("profile file count exceeded".into()); }
        if c.writers >= c.limits.3 { return Err("profile writers busy; retry later".into()); }
        c.bytes += bytes; c.files += 1; c.writers += 1;
        Ok(())
    }
    fn release(&self, bytes: u64, files: usize, writers: usize) {
        let mut c = self.0.lock().unwrap();
        c.bytes -= bytes; c.files -= files; c.writers -= writers;
    }
}

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

// Fresh single-writer stores share atomic profile reservations. Production
// persistence, authorization and crash recovery belong to the owning runtime tasks.
pub struct Store {
    root: PathBuf,
    item_bytes: u64,
    total_bytes: u64,
    max_items: usize,
    sizes: BTreeMap<String, u64>,
    used: u64,
    pool: DiskPool,
}
pub struct Transfer<'a> {
    store: &'a mut Store,
    key: String,
    file: Option<File>,
    expected: u64,
    written: u64,
    failed: bool,
    committed: bool,
}
impl Store {
    pub fn shared(root: &Path, item_bytes: u64, total_bytes: u64, max_items: usize, pool: DiskPool) -> Result<Self, String> {
        {
            let mut counts = pool.0.lock().unwrap();
            if counts.stores >= counts.limits.2 { return Err("profile store count exceeded".into()); }
            fs::create_dir(root).map_err(error)?;
            counts.stores += 1;
        }
        Ok(Self { root: root.into(), item_bytes, total_bytes, max_items, sizes: BTreeMap::new(), used: 0, pool })
    }
    pub fn new(root: &Path, item_bytes: u64, total_bytes: u64, max_items: usize) -> Self {
        Self::shared(root, item_bytes, total_bytes, max_items, DiskPool::new(total_bytes, max_items + 1, 1, 1)).expect("fresh synthetic fixture directory")
    }
    pub fn begin(&mut self, key: &str, bytes: u64) -> Result<Transfer<'_>, String> {
        if key.is_empty() || key.len() > 64 || !key.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_') { return Err("invalid key".into()); }
        if bytes > self.item_bytes { return Err("item bytes exceeded".into()); }
        if !self.sizes.contains_key(key) && self.sizes.len() >= self.max_items { return Err("item count exceeded".into()); }
        // Include the old file while staging its replacement; net-size accounting
        // would exceed the retained-plus-staged content budget before rename.
        if bytes > self.total_bytes - self.used { return Err("store bytes exceeded; free space before writing".into()); }
        self.pool.reserve(bytes)?;
        let file = match File::options().write(true).create_new(true).open(self.root.join(".pending")) {
            Ok(file) => file,
            Err(err) => { self.pool.release(bytes, 1, 1); return Err(error(err)); }
        };
        Ok(Transfer { store: self, key: key.into(), file: Some(file), expected: bytes, written: 0, failed: false, committed: false })
    }
    pub fn remove(&mut self, key: &str) -> Result<(), String> {
        let bytes = *self.sizes.get(key).ok_or("unknown key")?;
        fs::remove_file(self.root.join(key)).map_err(error)?;
        self.sizes.remove(key);
        self.used -= bytes;
        self.pool.release(bytes, 1, 0);
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
        let old = self.store.sizes.insert(self.key.clone(), self.written);
        self.store.used = self.store.used - old.unwrap_or(0) + self.written;
        self.store.pool.release(old.unwrap_or(0), usize::from(old.is_some()), 1);
        self.committed = true;
        Ok(())
    }
}
impl Drop for Transfer<'_> {
    fn drop(&mut self) {
        drop(self.file.take());
        if self.committed { return; }
        // Failed cleanup keeps the reservation charged rather than admitting
        // more bytes over retained staging; recovery is a production obligation.
        match fs::remove_file(self.store.root.join(".pending")) {
            Ok(()) => self.store.pool.release(self.expected, 1, 1),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => self.store.pool.release(self.expected, 1, 1),
            Err(_) => {},
        }
    }
}
fn error(err: impl std::fmt::Display) -> String { err.to_string() }
