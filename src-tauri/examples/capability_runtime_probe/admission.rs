//! Disposable host-operation admission experiment, not a transport allocation bound.
use std::{collections::BTreeMap, sync::{Arc, Mutex}};
use serde::Serialize;

pub const MAX_REQUEST_BYTES: usize = 65_536;
pub const MAX_CALLER_IN_FLIGHT: usize = 4;
pub const MAX_TOTAL_IN_FLIGHT: usize = 6;
pub const MAX_TOTAL_BYTES: usize = 4 * MAX_REQUEST_BYTES;

#[derive(Clone, Default)]
pub struct Admission(Arc<Mutex<Counts>>);

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct Counts {
    callers: BTreeMap<String, usize>,
    in_flight: usize,
    bytes: usize,
    peak_in_flight: usize,
    peak_bytes: usize,
    rejected: usize,
}

pub struct Permit { admission: Admission, caller: String, bytes: usize }

impl Admission {
    pub fn acquire(&self, caller: &str, bytes: usize) -> Result<Permit, &'static str> {
        if !["probe-a", "probe-b"].contains(&caller) { return Err("unknown caller"); }
        if bytes > MAX_REQUEST_BYTES { return Err("request too large"); }
        let mut counts = self.0.lock().unwrap();
        let reason = if counts.callers.get(caller).copied().unwrap_or(0) >= MAX_CALLER_IN_FLIGHT {
            Some("caller busy")
        } else if counts.in_flight >= MAX_TOTAL_IN_FLIGHT {
            Some("host busy")
        } else if bytes > MAX_TOTAL_BYTES - counts.bytes {
            Some("byte budget exceeded")
        } else { None };
        if let Some(reason) = reason { counts.rejected += 1; return Err(reason); }
        *counts.callers.entry(caller.into()).or_default() += 1;
        counts.in_flight += 1;
        counts.bytes += bytes;
        counts.peak_in_flight = counts.peak_in_flight.max(counts.in_flight);
        counts.peak_bytes = counts.peak_bytes.max(counts.bytes);
        Ok(Permit { admission: self.clone(), caller: caller.into(), bytes })
    }

    pub fn snapshot(&self) -> serde_json::Value { serde_json::to_value(&*self.0.lock().unwrap()).unwrap() }
}

impl Drop for Permit {
    fn drop(&mut self) {
        let mut counts = self.admission.0.lock().unwrap();
        let active = counts.callers.get_mut(&self.caller).unwrap();
        *active -= 1;
        if *active == 0 { counts.callers.remove(&self.caller); }
        counts.in_flight -= 1;
        counts.bytes -= self.bytes;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn caller_and_size_limits_do_not_consume_capacity() {
        let admission = Admission::default();
        assert!(matches!(admission.acquire("unregistered", 1), Err("unknown caller")));
        assert!(matches!(admission.acquire("probe-a", MAX_REQUEST_BYTES + 1), Err("request too large")));
        let held: Vec<_> = (0..MAX_CALLER_IN_FLIGHT).map(|_| admission.acquire("probe-a", 1).unwrap()).collect();
        assert!(matches!(admission.acquire("probe-a", 1), Err("caller busy")));
        assert!(admission.acquire("probe-b", 1).is_ok());
        drop(held);
        assert_eq!(admission.snapshot()["inFlight"], 0);
        assert_eq!(admission.snapshot()["bytes"], 0);
    }

    #[test]
    fn aggregate_count_and_bytes_are_independent_bounds() {
        let admission = Admission::default();
        let held: Vec<_> = (0..MAX_TOTAL_IN_FLIGHT).map(|i| admission.acquire(if i % 2 == 0 { "probe-a" } else { "probe-b" }, 1).unwrap()).collect();
        assert!(matches!(admission.acquire("probe-a", 1), Err("host busy")));
        drop(held);
        let held: Vec<_> = (0..4).map(|i| admission.acquire(if i % 2 == 0 { "probe-a" } else { "probe-b" }, MAX_REQUEST_BYTES).unwrap()).collect();
        assert!(matches!(admission.acquire("probe-a", 1), Err("byte budget exceeded")));
        drop(held);
        assert!(admission.acquire("probe-a", MAX_REQUEST_BYTES).is_ok());
        assert_eq!(admission.snapshot()["bytes"], 0);
    }

    #[tokio::test]
    async fn cancellation_drops_the_permit_and_returns_capacity() {
        let admission = Admission::default();
        let permit = admission.acquire("probe-a", MAX_REQUEST_BYTES).unwrap();
        let task = tokio::spawn(async move { let _held = permit; std::future::pending::<()>().await; });
        task.abort();
        assert!(task.await.unwrap_err().is_cancelled());
        assert_eq!(admission.snapshot()["inFlight"], 0);
        assert_eq!(admission.snapshot()["bytes"], 0);
    }

    #[test]
    fn operation_failure_returns_capacity() {
        let admission = Admission::default();
        let result: Result<(), &str> = (|| {
            let _permit = admission.acquire("probe-a", MAX_REQUEST_BYTES)?;
            Err("synthetic operation failed")
        })();
        assert_eq!(result, Err("synthetic operation failed"));
        assert_eq!(admission.snapshot()["inFlight"], 0);
        assert_eq!(admission.snapshot()["bytes"], 0);
        assert!(admission.acquire("probe-a", MAX_REQUEST_BYTES).is_ok());
    }
}
