// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
  if std::env::args_os().nth(1).is_some_and(|arg| arg == "--capability-mcp") {
    let result = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap().block_on(app_lib::capability_mcp::serve_mcp());
    if let Err(error) = result { eprintln!("{error}"); std::process::exit(1); }
    return;
  }
  if std::env::args_os().nth(1).is_some_and(|arg| arg == "--capability-call") {
    let result = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap().block_on(app_lib::capability_mcp::call_once());
    if let Err(error) = result { eprintln!("{error}"); std::process::exit(1); }
    return;
  }
  if let Some(directory) = std::env::args_os().nth(1).filter(|arg| arg == "--conversation-worker").and_then(|_| std::env::args_os().nth(2)) {
    let result = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap()
      .block_on(app_lib::native_background::worker(std::path::Path::new(&directory)));
    if let Err(error) = result { eprintln!("{error}"); std::process::exit(1); }
    return;
  }
  app_lib::run();
}
