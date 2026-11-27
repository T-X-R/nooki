//! Resolve the application-bundled component and reuse Codex-owned file authentication.
use crate::capability_codex::{Settings,Authentication};
use crate::capability_agent_runs::ComponentIdentity;
use serde::Deserialize;
use std::{fs,path::Path};

#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
struct Distribution {protocol_revision:u32,sha256:String,patch_sha256:String,revision:String,default_model:String,target:String}

pub(crate) fn settings(resources:&Path,codex_home:&Path)->Result<Settings,String> {
    if !cfg!(all(target_os="macos",target_arch="aarch64")) {return Err("UNSUPPORTED_SERVICE: capability Codex distribution is unavailable for this platform".into());}
    resolve(resources,codex_home,include_str!(concat!(env!("OUT_DIR"),"/capability-codex.json")))
}
fn resolve(resources:&Path,codex_home:&Path,manifest:&str)->Result<Settings,String> {
    let distribution:Distribution=serde_json::from_str(manifest).map_err(|_|"UNSUPPORTED_SERVICE: capability Codex is not bundled")?;
    let source:serde_json::Value=serde_json::from_str(include_str!("../../native/codex/source.json")).map_err(|_|"UNSUPPORTED_SERVICE: invalid component source pin")?;
    if distribution.target!="aarch64-apple-darwin" || distribution.protocol_revision!=2
        || distribution.revision!=source["revision"] || distribution.patch_sha256!=source["patchSha256"] || !codex_home.is_absolute() {
        return Err("UNSUPPORTED_SERVICE: capability Codex distribution differs from the application source pin".into());
    }
    // Configuration values only. Credentials remain in the native owner's file and are never read here.
    let config=match fs::read_to_string(codex_home.join("config.toml")) {
        Ok(text) if text.len()<=1_000_000=>toml::from_str::<toml::Value>(&text).map_err(|_|"UNSUPPORTED_SERVICE: Codex configuration is invalid")?,
        Err(error) if error.kind()==std::io::ErrorKind::NotFound=>toml::Value::Table(Default::default()),
        _=>return Err("UNSUPPORTED_SERVICE: Codex configuration is unavailable".into()),
    };
    let profile=match config.get("profile") {
        None=>None,
        Some(value)=>Some(config.get("profiles").and_then(|v|value.as_str().and_then(|key|v.get(key)))
            .filter(|v|v.is_table()).ok_or("UNSUPPORTED_SERVICE: selected Codex profile is unavailable")?),
    };
    let selected=|key:&str|profile.and_then(|p|p.get(key)).or_else(||config.get(key));
    if selected("model_provider").is_some_and(|v|v.as_str()!=Some("openai"))
        || selected("cli_auth_credentials_store").is_some_and(|v|!matches!(v.as_str(),Some("file"|"auto"))) {
        return Err("UNSUPPORTED_SERVICE: capability Codex requires the native OpenAI provider and file login".into());
    }
    let model=match selected("model") {Some(v)=>v.as_str().ok_or("UNSUPPORTED_SERVICE: invalid Codex model")?.to_string(),None=>distribution.default_model};
    let settings=Settings {questions:true,binary:resources.join("capability-codex/codex-app-server"),model,
        component:ComponentIdentity{protocol_revision:distribution.protocol_revision,sha256:distribution.sha256},
        authentication:Authentication::CodexFile{path:codex_home.join("auth.json")}};
    settings.policy()?;Ok(settings)
}
#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest,Sha256};
    #[test]
    fn bundled_identity_and_codex_profile_are_required_without_reading_credentials() {
        let root=std::env::temp_dir().join(format!("nooki-component-{}",crate::capability_authority::nonce().unwrap()));
        fs::create_dir_all(root.join("capability-codex")).unwrap();fs::create_dir(root.join("home")).unwrap();
        fs::write(root.join("capability-codex/codex-app-server"),b"synthetic binary identity").unwrap();
        let source:serde_json::Value=serde_json::from_str(include_str!("../../native/codex/source.json")).unwrap();
        let mut manifest=serde_json::json!({"protocolRevision":2,"sha256":format!("{:x}",Sha256::digest(b"synthetic binary identity")),
            "patchSha256":source["patchSha256"],"revision":source["revision"],"defaultModel":"pinned-default","target":"aarch64-apple-darwin"});
        let home=root.join("home");assert_eq!(resolve(&root,&home,&manifest.to_string()).unwrap().model,"pinned-default");
        fs::write(home.join("config.toml"),"model='base'\nprofile='work'\n[profiles.work]\nmodel='selected'\n").unwrap();
        assert_eq!(resolve(&root,&home,&manifest.to_string()).unwrap().model,"selected");
        assert!(!home.join("auth.json").exists());
        fs::write(home.join("config.toml"),"model_provider='other'\n").unwrap();assert!(resolve(&root,&home,&manifest.to_string()).is_err());
        fs::write(home.join("config.toml"),"").unwrap();manifest["sha256"]=serde_json::json!("0".repeat(64));
        assert!(resolve(&root,&home,&manifest.to_string()).is_err());fs::remove_dir_all(root).unwrap();
    }
}
