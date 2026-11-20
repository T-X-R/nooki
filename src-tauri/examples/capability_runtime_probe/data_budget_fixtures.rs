use super::data_budget::*;
use std::{fs::{self, File}, io::{Read, Write}, path::{Path, PathBuf}, sync::atomic::{AtomicUsize, Ordering}, time::Instant};
#[cfg(test)]
use std::io::{Seek, SeekFrom};
use serde_json::{json, Value};

struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let root = std::env::temp_dir().join(format!("nooki-data-budget-{}-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos(), NEXT.fetch_add(1, Ordering::Relaxed)));
        fs::create_dir(&root).unwrap();
        Self(root)
    }
}
impl Drop for Fixture { fn drop(&mut self) { fs::remove_dir_all(&self.0).unwrap(); } }

fn archive(path: &Path, sizes: &[u64]) {
    archive_method(path, sizes, zip::CompressionMethod::Deflated);
}

fn archive_method(path: &Path, sizes: &[u64], method: zip::CompressionMethod) {
    let mut zip = zip::ZipWriter::new(File::create(path).unwrap());
    let chunk = vec![b'x'; CHUNK];
    for (i, size) in sizes.iter().enumerate() {
        zip.start_file(format!("assets/{i}.bin"), zip::write::SimpleFileOptions::default().compression_method(method)).unwrap();
        let mut remaining = *size;
        while remaining > 0 {
            let count = remaining.min(CHUNK as u64) as usize;
            zip.write_all(&chunk[..count]).unwrap();
            remaining -= count as u64;
        }
    }
    zip.finish().unwrap();
}

fn fill(store: &mut Store, key: &str, bytes: u64, value: u8) {
    let chunk = vec![value; CHUNK];
    let mut pending = store.begin(key, bytes).unwrap();
    let mut remaining = bytes;
    while remaining > 0 {
        let count = remaining.min(CHUNK as u64) as usize;
        pending.write(&chunk[..count]).unwrap();
        remaining -= count as u64;
    }
    pending.commit().unwrap();
}

fn exact(path: &Path, expected: u64, value: u8) {
    let mut file = File::open(path).unwrap();
    let mut chunk = [0; CHUNK];
    let mut total = 0;
    loop {
        let count = file.read(&mut chunk).unwrap();
        if count == 0 { break; }
        assert!(chunk[..count].iter().all(|byte| *byte == value));
        total += count as u64;
    }
    assert_eq!(total, expected);
}

pub fn measure() -> Value {
    let start = Instant::now();
    let fixture = Fixture::new();
    let zip = fixture.0.join("fixture.zip");
    archive(&zip, &[ENTRY_BYTES; 4]);
    let compressed = fs::metadata(&zip).unwrap().len();
    assert_eq!(inspect(File::open(&zip).unwrap()).unwrap(), EXPANDED_BYTES);
    archive(&zip, &[ENTRY_BYTES, ENTRY_BYTES, ENTRY_BYTES, ENTRY_BYTES, 1]);
    assert!(inspect(File::open(&zip).unwrap()).unwrap_err().contains("expanded"));
    archive(&zip, &[ENTRY_BYTES + 1]);
    assert!(inspect(File::open(&zip).unwrap()).unwrap_err().contains("entry bytes"));
    archive(&zip, &vec![0; ENTRIES]);
    assert_eq!(inspect(File::open(&zip).unwrap()).unwrap(), 0);
    archive(&zip, &vec![0; ENTRIES + 1]);
    assert!(inspect(File::open(&zip).unwrap()).unwrap_err().contains("entry count"));
    File::create(&zip).unwrap().set_len(ARCHIVE_BYTES + 1).unwrap();
    assert!(inspect(File::open(&zip).unwrap()).unwrap_err().contains("archive bytes"));
    archive_method(&zip, &[0, 0], zip::CompressionMethod::Stored);
    let headers = fs::metadata(&zip).unwrap().len();
    archive_method(&zip, &[ENTRY_BYTES, ARCHIVE_BYTES - ENTRY_BYTES - headers], zip::CompressionMethod::Stored);
    assert_eq!(fs::metadata(&zip).unwrap().len(), ARCHIVE_BYTES);
    assert_eq!(inspect(File::open(&zip).unwrap()).unwrap(), ARCHIVE_BYTES - headers);

    let root = fixture.0.join("private");
    let mut store = Store::new(&root, 256 * 1024, 16 * MIB, 256);
    for i in 0..64 { fill(&mut store, &format!("key{i}"), 256 * 1024, i as u8); }
    assert!(store.begin("overflow", 1).is_err());
    assert_eq!(store.usage(), (64, 16 * MIB));
    store.remove("key0").unwrap();
    fill(&mut store, "replacement", 256 * 1024, 99);
    exact(&root.join("replacement"), 256 * 1024, 99);
    // A rejected replacement preserves the full old value, including at capacity.
    assert!(store.begin("replacement", 256 * 1024 + 1).is_err());
    assert!(store.begin("replacement", 256 * 1024).is_err(), "old plus staged bytes count against the limit");
    exact(&root.join("replacement"), 256 * 1024, 99);
    store.remove("key1").unwrap();
    fill(&mut store, "replacement", 256 * 1024, 100);
    exact(&root.join("replacement"), 256 * 1024, 100);
    assert_eq!(store.usage(), (63, 16 * MIB - 256 * 1024));
    let count_root = fixture.0.join("count");
    let mut count_store = Store::new(&count_root, 256 * 1024, 16 * MIB, 256);
    for i in 0..256 { fill(&mut count_store, &format!("key{i}"), 0, 0); }
    assert!(count_store.begin("overflow", 0).is_err());

    let root = fixture.0.join("transfer");
    let mut store = Store::new(&root, 64 * MIB, 128 * MIB, 4);
    fill(&mut store, "artifact", 64 * MIB, 42);
    exact(&root.join("artifact"), 64 * MIB, 42);
    assert!(store.begin("oversized", 64 * MIB + 1).is_err());
    {
        let mut pending = store.begin("partial", 8 * MIB).unwrap();
        pending.write(&vec![1; CHUNK]).unwrap();
        assert!(pending.commit().is_err());
    }
    {
        let mut pending = store.begin("cancelled", 8 * MIB).unwrap();
        pending.write(&vec![2; CHUNK]).unwrap();
    }
    assert!(!root.join("partial").exists() && !root.join("cancelled").exists());
    assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
    assert_eq!(store.usage(), (1, 64 * MIB));
    {
        let mut pending = store.begin("artifact", 8 * MIB).unwrap();
        assert!(pending.write(&vec![0; CHUNK + 1]).is_err());
    }
    exact(&root.join("artifact"), 64 * MIB, 42);
    fill(&mut store, "second", 64 * MIB, 43);
    assert!(store.begin("full", 1).is_err());
    store.remove("second").unwrap();
    fill(&mut store, "recovered", 8 * MIB, 44);
    exact(&root.join("recovered"), 8 * MIB, 44);

    // The same 60-second PCM shape used by the desktop media probe, transferred as
    // bytes here. Codec/playback verification remains the desktop probe's evidence.
    let sample_bytes = 60 * 8000 * 2u32;
    let mut wav = Vec::from(&b"RIFF"[..]);
    wav.extend((36 + sample_bytes).to_le_bytes()); wav.extend(b"WAVEfmt ");
    wav.extend(16u32.to_le_bytes()); wav.extend(1u16.to_le_bytes()); wav.extend(1u16.to_le_bytes());
    wav.extend(8000u32.to_le_bytes()); wav.extend(16000u32.to_le_bytes());
    wav.extend(2u16.to_le_bytes()); wav.extend(16u16.to_le_bytes());
    wav.extend(b"data"); wav.extend(sample_bytes.to_le_bytes()); wav.resize(44 + sample_bytes as usize, 0);
    let mut pending = store.begin("audio", wav.len() as u64).unwrap();
    for chunk in wav.chunks(CHUNK) { pending.write(chunk).unwrap(); }
    pending.commit().unwrap();
    assert_eq!(fs::read(root.join("audio")).unwrap(), wav);
    fill(&mut store, "empty", 0, 0);
    assert!(store.begin("fifth", 0).is_err());
    json!({"archive": {"compressedBytesFor64MiB": compressed, "compressedBoundaryBytes": ARCHIVE_BYTES, "expandedBytes": EXPANDED_BYTES, "maxEntryBytes": ENTRY_BYTES, "maxEntries": ENTRIES}, "private": {"itemBytes": 262144, "totalBytes": 16 * MIB, "maxItems":256, "rejectionPreservedBytes":true, "stagingCountsOldBytes":true}, "transfer": {"itemBytes":64 * MIB, "totalBytes":128 * MIB, "chunkBytes":CHUNK, "maxItems":4, "audioBytes":wav.len(), "cancelledStagingRemoved":true, "finalUsage":store.usage()}, "elapsedMs":start.elapsed().as_millis()})
}

#[test]
fn boundary_loads_preserve_bytes_and_reclaim_staging() { measure(); }

#[test]
fn failed_write_and_commit_never_publish_or_replace_previous_data() {
    let fixture = Fixture::new();
    let root = fixture.0.join("store");
    let mut store = Store::new(&root, 128, 256, 4);
    fill(&mut store, "old", 8, 7);
    {
        let mut pending = store.begin("old", 8).unwrap();
        assert!(pending.write(&[0; 9]).is_err());
        assert!(pending.write(&[0; 8]).is_err());
        assert!(pending.commit().is_err());
    }
    exact(&root.join("old"), 8, 7);
    // A real rename error must roll back staging and leave the ledger unchanged.
    fs::create_dir(root.join("blocked")).unwrap();
    let mut pending = store.begin("blocked", 8).unwrap();
    pending.write(&[1; 8]).unwrap();
    assert!(pending.commit().is_err());
    assert!(!root.join(".pending").exists());
    assert_eq!(store.usage(), (1, 8));
    fill(&mut store, "recovery", 8, 3);
    exact(&root.join("recovery"), 8, 3);
    for key in ["../escape", "/absolute", ".pending", "a/b", ""] { assert!(store.begin(key, 0).is_err()); }
}

#[test]
fn corrupt_and_unsafe_archives_are_rejected_without_extracting() {
    let fixture = Fixture::new();
    let path = fixture.0.join("fixture.zip");
    for name in ["../escape", "/absolute", "assets/../escape", "a\\b", "a//b"] {
        let mut zip = zip::ZipWriter::new(File::create(&path).unwrap());
        zip.start_file(name, zip::write::SimpleFileOptions::default()).unwrap();
        zip.write_all(b"synthetic").unwrap(); zip.finish().unwrap();
        assert!(inspect(File::open(&path).unwrap()).unwrap_err().contains("invalid archive path"));
    }
    archive_method(&path, &[8], zip::CompressionMethod::Stored);
    let mut file = File::options().read(true).write(true).open(&path).unwrap();
    let mut header = [0; 30]; file.read_exact(&mut header).unwrap();
    let start = 30 + u16::from_le_bytes([header[26], header[27]]) as u64 + u16::from_le_bytes([header[28], header[29]]) as u64;
    file.seek(SeekFrom::Start(start)).unwrap(); file.write_all(b"z").unwrap(); drop(file);
    assert!(inspect(File::open(&path).unwrap()).is_err(), "CRC corruption must be read and rejected");
    assert_eq!(fs::read_dir(&fixture.0).unwrap().count(), 1);
}
