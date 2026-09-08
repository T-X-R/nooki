fn main() {
  for path in ["../skills/workbench-capability-dev", "../packages/capability-contract", "../packages/capability-ui", "../scripts/build-capability-kit.mjs", "../scripts/package-capability.mjs", "../src/styles.css", "../INFRASTRUCTURE.md", "../package.json"] {
    println!("cargo:rerun-if-changed={path}");
  }
  let output = std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap()).join("developer-kit.json");
  let status = std::process::Command::new("node")
    .arg("../scripts/build-capability-kit.mjs").arg(output).status()
    .expect("Node.js is required to assemble the capability development kit");
  assert!(status.success(), "Could not assemble capability development kit");
  tauri_build::build()
}
