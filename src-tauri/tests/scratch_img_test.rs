use app_lib::skill_pool::SkillPool;
use std::{fs, path::PathBuf};
#[test]
fn scratch_image() {
  let home = PathBuf::from("/tmp/nooki-sandbox-home");
  let pool = SkillPool::new(home.clone(), home.join("data"));
  let detail = pool.read("sandbox-with-files").unwrap();
  println!("files: {:?}", detail.files);
  let file = pool.read_file("sandbox-with-files", "pdf.png").unwrap();
  println!("kind={} size={} prefix={}", file.kind, file.size_bytes, &file.content[..60.min(file.content.len())]);
  fs::write("/tmp/nooki-image-dataurl.txt", &file.content).unwrap();
}
