use std::{collections::HashMap, sync::Mutex};
use tokio_util::sync::CancellationToken;

#[derive(Default)]
pub struct TaskExecutions(Mutex<HashMap<String, CancellationToken>>);

impl TaskExecutions {
  pub fn token(&self, id: &str) -> Result<CancellationToken, String> {
    let mut tokens = self.0.lock().map_err(|_| "任务取消状态不可用")?;
    Ok(tokens.entry(id.to_string()).or_default().clone())
  }

  pub fn cancel(&self, id: &str) -> Result<(), String> {
    // Retain cancellation for this attempt so a late-starting request cannot run.
    self.token(id)?.cancel();
    Ok(())
  }
}
