fn main() {
  for path in ["../skills/workbench-capability-dev", "../packages/capability-contract", "../packages/capability-ui", "../scripts/build-capability-kit.mjs", "../scripts/package-capability.mjs", "../src/app/global.css", "../INFRASTRUCTURE.md", "../package.json"] {
    println!("cargo:rerun-if-changed={path}");
  }
  let output = std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap()).join("developer-kit.json");
  let status = std::process::Command::new("node")
    .arg("../scripts/build-capability-kit.mjs").arg(output).status()
    .expect("Node.js is required to assemble the capability development kit");
  assert!(status.success(), "Could not assemble capability development kit");
  let component = std::path::Path::new("resources/capability-codex/component.json");
  println!("cargo:rerun-if-changed={}",component.display());
  let manifest = std::fs::read(component).unwrap_or_else(|_| b"null".to_vec());
  std::fs::write(std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap()).join("capability-codex.json"),manifest)
    .expect("Could not embed capability component identity");
  tauri_build::build()
}
