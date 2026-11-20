use super::{data_budget::*, fixtures::{Fixture, fill, exact}};
use serde_json::{json, Value};
use super::live_resources::*;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use sha2::{Digest, Sha256};

fn disk_measure() -> Value {
    let fixture = Fixture::new();
    let pool = DiskPool::new(64 * MIB, 1024, 16, 4);
    let mut stores: Vec<_> = (0..5).map(|i| Store::shared(&fixture.0.join(format!("private{i}")), 256 * 1024, 16 * MIB, 256, pool.clone()).unwrap()).collect();
    for store in stores.iter_mut().take(4) {
        for key in 0..64 { fill(store, &format!("key{key}"), 256 * 1024, 42); }
    }
    assert!(stores[4].begin("extra", 1).is_err());
    let full = pool.snapshot();
    assert_eq!(full["bytes"], 64 * MIB);
    stores[0].remove("key0").unwrap();
    fill(&mut stores[4], "reclaimed", 256 * 1024, 43);
    exact(&fixture.0.join("private4/reclaimed"), 256 * 1024, 43);
    drop(stores);
    assert_eq!(pool.snapshot()["bytes"], 64 * MIB, "dropping store handles must not uncharge retained files");

    let transfer = DiskPool::new(256 * MIB, 16, 8, 4);
    let mut stores: Vec<_> = (0..5).map(|i| Store::shared(&fixture.0.join(format!("transfer{i}")), 64 * MIB, 128 * MIB, 4, transfer.clone()).unwrap()).collect();
    for store in stores.iter_mut().take(4) { fill(store, "artifact", 64 * MIB, 11); }
    assert!(stores[4].begin("extra", 1).is_err());
    let transfer_full = transfer.snapshot();
    assert_eq!(transfer_full["bytes"], 256 * MIB);
    stores[0].remove("artifact").unwrap();
    {
        let mut staged = stores[4].begin("cancelled", 64 * MIB).unwrap();
        staged.write(&vec![2; CHUNK]).unwrap();
        assert_eq!(transfer.snapshot()["bytes"], 256 * MIB, "reserve declared size before writing");
    }
    assert_eq!(transfer.snapshot()["bytes"], 192 * MIB);
    assert!(!fixture.0.join("transfer4/.pending").exists());
    fill(&mut stores[4], "recovered", 64 * MIB, 12);
    exact(&fixture.0.join("transfer4/recovered"), 64 * MIB, 12);

    // Global writer count is tested separately from per-store mutable ownership.
    let count_pool = DiskPool::new(16, 16, 5, 4);
    let mut count_stores: Vec<_> = (0..5).map(|i| Store::shared(&fixture.0.join(format!("counts{i}")), 1, 1, 1, count_pool.clone()).unwrap()).collect();
    let (first, last) = count_stores.split_at_mut(4);
    let held: Vec<_> = first.iter_mut().map(|s| s.begin("empty", 0).unwrap()).collect();
    assert!(last[0].begin("overflow", 0).is_err());
    assert_eq!(count_pool.snapshot()["writers"], 4);
    drop(held);
    assert_eq!(count_pool.snapshot()["writers"], 0);
    fill(&mut last[0], "recovered", 0, 0);
    assert!(Store::shared(&fixture.0.join("sixth"), 1, 1, 1, count_pool).is_err());
    let file_pool = DiskPool::new(64 * MIB, 1024, 16, 4);
    let mut file_stores: Vec<_> = (0..16).map(|i| Store::shared(&fixture.0.join(format!("filecounts{i}")), 256 * 1024, 16 * MIB, 256, file_pool.clone()).unwrap()).collect();
    for store in file_stores.iter_mut().take(4) { for i in 0..256 { fill(store, &format!("key{i}"), 0, 0); } }
    assert!(file_stores[4].begin("overflow", 0).is_err());
    assert!(Store::shared(&fixture.0.join("store17"), 1, 1, 1, file_pool.clone()).is_err());
    let private_count_full = file_pool.snapshot();
    assert_eq!(private_count_full["files"], 1024); assert_eq!(private_count_full["stores"], 16);
    for store in &mut stores {
        for i in 0..4 {
            if transfer.snapshot()["files"] == 16 || store.usage().0 == 4 { break; }
            fill(store, &format!("empty{i}"), 0, 0);
        }
    }
    assert!(stores[4].begin("overflow", 0).is_err());
    for i in 5..8 { Store::shared(&fixture.0.join(format!("transfer{i}")), 64 * MIB, 128 * MIB, 4, transfer.clone()).unwrap(); }
    assert!(Store::shared(&fixture.0.join("transfer8"), 1, 1, 1, transfer.clone()).is_err());
    let transfer_count_full = transfer.snapshot();
    assert_eq!(transfer_count_full["files"], 16); assert_eq!(transfer_count_full["stores"], 8);
    json!({"privateFull":full,"privateCountFull":private_count_full,"transferFull":transfer_full,"transferCountFull":transfer_count_full,"declaredStagingReserved":true,"droppedStorePreservesCharge":true,"writerLimit":4})
}

async fn live_measure() -> Value {
    let events = LivePool::new(64, 128, 256 * 1024, 512 * 1024);
    let mut queue = Events::new(events.clone());
    assert!(queue.push("a", &vec![0; EVENT_BYTES + 1]).is_err());
    assert!(queue.push("unregistered", b"x").is_err());
    for owner in ["a", "b"] { for i in 0..16 { queue.push(owner, &vec![i as u8; EVENT_BYTES]).unwrap(); } }
    let bytes_full = events.snapshot();
    assert_eq!(bytes_full["bytes"], 512 * 1024);
    assert!(queue.push("c", b"x").is_err());
    assert!(queue.push("a", b"x").is_err());
    let delivered = queue.pop().unwrap();
    assert!(delivered.bytes().iter().all(|b| *b == 0));
    assert_eq!(events.snapshot()["bytes"], 512 * 1024, "delivery is charged until acknowledgement/drop");
    drop(delivered);
    queue.push("c", &vec![99; EVENT_BYTES]).unwrap();
    queue.discard_owner("a");
    for i in 0..16 { let event = queue.pop().unwrap(); assert!(event.bytes().iter().all(|b| *b == i)); }
    assert!(queue.pop().unwrap().bytes().iter().all(|b| *b == 99));
    assert_eq!(events.snapshot()["bytes"], 0);
    for owner in ["a", "b"] { for _ in 0..64 { queue.push(owner, b"").unwrap(); } }
    assert!(queue.push("a", b"").is_err());
    assert!(queue.push("c", b"").is_err());
    let count_full = events.snapshot();
    assert_eq!(count_full["count"], 128);
    drop(queue);
    assert_eq!(events.snapshot()["count"], 0);

    let runs = LivePool::new(2, 4, 0, 0);
    let mut tasks = Vec::new();
    let expected: [u8; 32] = Sha256::digest(vec![42; CHUNK]).into();
    for owner in ["a", "a", "b", "b"] {
        let (task, digest) = OwnedTask::run(&runs, owner).await.unwrap();
        assert_eq!(digest, expected);
        tasks.push(task);
    }
    assert!(OwnedTask::run(&runs, "a").await.is_err());
    assert!(OwnedTask::run(&runs, "c").await.is_err());
    let runs_full = runs.snapshot();
    tasks.remove(0).stop().await;
    assert_eq!(runs.snapshot()["count"], 3);
    let (recovery, digest) = OwnedTask::run(&runs, "c").await.unwrap();
    assert_eq!(digest, expected);
    recovery.stop().await;
    for task in tasks { task.stop().await; }
    assert_eq!(runs.snapshot()["count"], 0);

    let services = LivePool::new(1, 2, 0, 0);
    let (a, mut peer_a) = OwnedTask::service(&services, "a").await.unwrap();
    let (b, mut peer_b) = OwnedTask::service(&services, "b").await.unwrap();
    for peer in [&mut peer_a, &mut peer_b] { let mut ready = [0; 5]; peer.read_exact(&mut ready).await.unwrap(); assert_eq!(&ready, b"ready"); }
    assert!(OwnedTask::service(&services, "a").await.is_err());
    assert!(OwnedTask::service(&services, "c").await.is_err());
    let services_full = services.snapshot();
    a.stop().await;
    assert_eq!(peer_a.read(&mut [0; 1]).await.unwrap(), 0, "stop must close the actual native stream");
    assert_eq!(services.snapshot()["count"], 1);
    peer_b.write_all(b"still alive").await.unwrap();
    let mut echo = [0; 11]; peer_b.read_exact(&mut echo).await.unwrap(); assert_eq!(&echo, b"still alive");
    let (c, mut peer_c) = OwnedTask::service(&services, "c").await.unwrap();
    let mut ready = [0; 5]; peer_c.read_exact(&mut ready).await.unwrap(); assert_eq!(&ready, b"ready");
    b.stop().await; c.stop().await;
    assert_eq!(peer_b.read(&mut [0; 1]).await.unwrap(), 0);
    assert_eq!(peer_c.read(&mut [0; 1]).await.unwrap(), 0);
    assert_eq!(services.snapshot()["count"], 0);
    json!({"eventBytePeak":bytes_full,"eventCountPeak":count_full,"eventItemBytes":EVENT_BYTES,"deliveredBytesChargedUntilDrop":true,"runPeak":runs_full,"runPayloadBytes":CHUNK,"servicePeak":services_full,"stoppedServicesObservedEof":3,"peerEchoAfterStop":true,"finalEvents":events.snapshot(),"finalRuns":runs.snapshot(),"finalServices":services.snapshot()})
}

pub async fn measure() -> Value {
    let disk = disk_measure();
    let live = tokio::time::timeout(std::time::Duration::from_secs(10), live_measure()).await.expect("live resource fixture must terminate");
    json!({"disk":disk,"live":live})
}

#[test]
fn shared_disk_reservations_follow_files_and_staging() { disk_measure(); }

#[tokio::test]
async fn owned_payloads_tasks_and_services_release_real_resources() {
    tokio::time::timeout(std::time::Duration::from_secs(10), live_measure()).await.unwrap();
}

#[test]
fn simultaneous_stores_cannot_overcommit_shared_bytes() {
    use std::sync::{Arc, Barrier};
    let fixture = Fixture::new();
    let pool = DiskPool::new(24 * MIB, 4, 2, 2);
    let gates = Arc::new((Barrier::new(3), Barrier::new(3)));
    let handles: Vec<_> = (0..2).map(|i| {
        let mut store = Store::shared(&fixture.0.join(format!("race{i}")), 16 * MIB, 16 * MIB, 1, pool.clone()).unwrap();
        let gates = gates.clone();
        std::thread::spawn(move || {
            let mut pending = store.begin("data", 16 * MIB);
            let admitted = pending.is_ok();
            if let Ok(transfer) = &mut pending { for _ in 0..256 { transfer.write(&[42; CHUNK]).unwrap(); } }
            gates.0.wait(); gates.1.wait();
            drop(pending);
            admitted
        })
    }).collect();
    gates.0.wait();
    let occupied = pool.snapshot();
    gates.1.wait();
    assert_eq!(handles.into_iter().map(|handle| usize::from(handle.join().unwrap())).sum::<usize>(), 1);
    assert_eq!(occupied["bytes"], 16 * MIB);
    assert_eq!(pool.snapshot()["bytes"], 0);
    assert_eq!(pool.snapshot()["files"], 0);
}

#[test]
fn disk_file_limits_and_cleanup_failure_do_not_undercharge() {
    use std::fs;
    let fixture = Fixture::new();
    let pool = DiskPool::new(MIB, 2, 2, 2);
    let mut a = Store::shared(&fixture.0.join("a"), MIB, MIB, 4, pool.clone()).unwrap();
    let mut b = Store::shared(&fixture.0.join("b"), MIB, MIB, 4, pool.clone()).unwrap();
    fill(&mut a, "one", 0, 0); fill(&mut b, "two", 0, 0);
    assert!(a.begin("three", 0).is_err());
    a.remove("one").unwrap();
    let mut pending = a.begin("failedcleanup", 1).unwrap(); pending.write(&[42]).unwrap();
    fs::rename(fixture.0.join("a/.pending"), fixture.0.join("a/orphan")).unwrap();
    fs::create_dir(fixture.0.join("a/.pending")).unwrap();
    drop(pending);
    assert_eq!(pool.snapshot()["bytes"], 1);
    assert_eq!(pool.snapshot()["files"], 2);
    assert_eq!(pool.snapshot()["writers"], 1);
    exact(&fixture.0.join("a/orphan"), 1, 42);
    assert!(b.begin("mustnotfit", 0).is_err());
}

#[test]
fn simultaneous_event_queues_share_one_budget() {
    use std::sync::{Arc, Barrier};
    let pool = LivePool::new(1, 1, EVENT_BYTES, EVENT_BYTES);
    let gates = Arc::new((Barrier::new(3), Barrier::new(3)));
    let handles: Vec<_> = ["a", "b"].into_iter().map(|owner| {
        let pool = pool.clone(); let gates = gates.clone();
        std::thread::spawn(move || {
            let mut queue = Events::new(pool);
            let admitted = queue.push(owner, &[42; EVENT_BYTES]).is_ok();
            gates.0.wait(); gates.1.wait(); drop(queue); admitted
        })
    }).collect();
    gates.0.wait(); let occupied = pool.snapshot(); gates.1.wait();
    assert_eq!(handles.into_iter().map(|handle| usize::from(handle.join().unwrap())).sum::<usize>(), 1);
    assert_eq!(occupied["bytes"], EVENT_BYTES);
    assert_eq!(pool.snapshot()["count"], 0);
}
