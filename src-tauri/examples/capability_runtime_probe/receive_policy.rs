//! Disposable receive policy. It bounds owned copies, not WebKit's earlier native objects.
use std::{io::Read, sync::Mutex, time::{Duration, Instant}};

pub const BODY_BYTES: usize = 64 * 1024;
pub const URL_BYTES: usize = 2048;
pub const HEADER_BYTES: usize = 8192;
pub const REQUESTS_PER_SECOND: usize = 24;

#[derive(Default)]
pub struct Rate(Mutex<[Vec<Instant>; 2]>);
impl Rate {
    pub fn check(&self, owner: &str, now: Instant) -> Result<(), &'static str> {
        let index = match owner { "probe-a" => 0, "probe-b" => 1, _ => return Err("unknown native owner") };
        let mut history = self.0.lock().unwrap();
        history[index].retain(|at| now.saturating_duration_since(*at) < Duration::from_secs(1));
        if history[index].len() >= REQUESTS_PER_SECOND { return Err("receive rate exceeded; retry later"); }
        history[index].push(now);
        Ok(())
    }
}
pub fn read_body(reader: impl Read) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::with_capacity(BODY_BYTES + 1);
    reader.take((BODY_BYTES + 1) as u64).read_to_end(&mut bytes).map_err(|error| error.to_string())?;
    if bytes.len() > BODY_BYTES { return Err("request body too large".into()); }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_rate_is_caller_scoped_and_recovers_without_a_waiting_queue() {
        let rate = Rate::default(); let now = Instant::now();
        assert!(rate.check("spoofed", now).is_err());
        for _ in 0..REQUESTS_PER_SECOND { rate.check("probe-a", now).unwrap(); }
        assert!(rate.check("probe-a", now).is_err());
        rate.check("probe-b", now).unwrap();
        rate.check("probe-a", now + Duration::from_secs(1)).unwrap();
    }
    #[test]
    fn streamed_body_reads_only_the_limit_and_one_overflow_byte() {
        let mut source = std::io::Cursor::new(vec![42; BODY_BYTES + 100]);
        assert!(read_body(&mut source).is_err());
        assert_eq!(source.position(), BODY_BYTES as u64 + 1);
        assert_eq!(read_body(&vec![42; BODY_BYTES][..]).unwrap(), vec![42; BODY_BYTES]);
    }
    #[test]
    fn read_failure_is_not_treated_as_a_successful_partial_body() {
        struct Broken;
        impl Read for Broken { fn read(&mut self, _: &mut [u8]) -> std::io::Result<usize> { Err(std::io::Error::other("synthetic read failure")) } }
        assert!(read_body(Broken).unwrap_err().contains("synthetic read failure"));
    }
}
