//! Transient native requests. Only the Host can answer; package snapshots expose progress only.
use serde_json::{json,Value};
use std::collections::BTreeMap;

#[derive(Clone)]
struct Pending {handle:String,event:Value,attempted:bool}
#[derive(Default)]
pub(crate) struct Interactions {requests:BTreeMap<String,Pending>,progress:Option<Value>}
impl Interactions {
    pub fn event(&mut self,event:Value) {
        match event["method"].as_str().unwrap_or("") {
            "workbench/disconnected"=>{self.requests.clear();self.progress=None;},
            "serverRequest/resolved"=>{
                let key=event["params"]["requestId"].to_string();
                if self.requests.get(&key).is_some_and(|p|p.event["params"]["threadId"]==event["params"]["threadId"]){self.requests.remove(&key);}
            },
            _=>if event.get("id").is_some() && event.get("method").is_some() && event.to_string().len()<=65_536 {
                let key=event["id"].to_string();
                if self.requests.get(&key).is_some_and(|pending|pending.event==event){return;}
                if self.requests.len()<16 {
                    if let Ok(handle)=crate::capability_authority::nonce(){self.requests.insert(key,Pending{handle,event,attempted:false});}
                }
            },
        }
    }
    fn matches(event:&Value,native:&crate::capability_agent_runs::NativeIdentity)->bool {
        event["params"]["threadId"].as_str()==Some(native.thread_id.as_str())
            && event["params"]["turnId"].as_str()==native.turn_id.as_deref()
    }
    pub fn observe(&mut self,native:&crate::capability_agent_runs::NativeIdentity,turn:&Value) {
        self.requests.retain(|_,p|Self::matches(&p.event,native)&&turn["status"]=="inProgress");
        if turn["status"]!="inProgress" {self.progress=None;return;}
        // Only public assistant messages, never raw reasoning, tool arguments or filesystem paths.
        let text=turn["items"].as_array().into_iter().flatten().rev()
            .find(|item|item["type"]=="agentMessage").and_then(|item|item["text"].as_str()).unwrap_or("");
        let text:String=text.chars().take(2000).collect();
        self.progress=Some(json!({"text":text,"awaitingInput":!self.requests.is_empty()}));
    }
    pub fn progress(&self)->Option<Value>{self.progress.clone()}
    pub fn questions(&self,native:&crate::capability_agent_runs::NativeIdentity)->Vec<Value> {
        self.requests.values().filter(|p|Self::matches(&p.event,native)).map(|p| {
            let questions=questions(&p.event).ok();
            json!({"handle":p.handle,"answerPending":p.attempted,"questions":questions,"unsupported":questions.is_none()})
        }).collect()
    }
    pub fn answer(&mut self,native:&crate::capability_agent_runs::NativeIdentity,handle:&str,answers:&Value)->Result<(Value,Value),String> {
        let pending=self.requests.values_mut().find(|p|p.handle==handle&&Self::matches(&p.event,native))
            .ok_or("CONFLICT: native question is no longer pending")?;
        if pending.attempted{return Err("OUTCOME_UNKNOWN: answer was already submitted; wait for native observation".into());}
        let questions=questions(&pending.event)?;
        let values=answers.as_array().filter(|a|a.len()==questions.len()).ok_or("INVALID_INPUT: answer each question")?;
        let mut result=serde_json::Map::new();
        for (question,value) in questions.iter().zip(values) {
            let answer=value.as_str().filter(|s|!s.trim().is_empty()&&s.len()<=10_000&& !s.contains('\0')).ok_or("INVALID_INPUT: invalid answer")?;
            result.insert(question["id"].as_str().unwrap().into(),json!({"answers":[answer]}));
        }
        // Claim before transport send. Lost acknowledgements must not silently resend answers.
        pending.attempted=true;
        Ok((pending.event["id"].clone(),json!({"answers":result})))
    }
}
fn questions(event:&Value)->Result<Vec<Value>,String> {
    if event["method"]!="item/tool/requestUserInput"{return Err("PERMISSION_DENIED: this request cannot expand the approved policy".into());}
    let source=event["params"]["questions"].as_array().filter(|v|!v.is_empty()&&v.len()<=3).ok_or("INVALID_INPUT: invalid native questions")?;
    let mut ids=std::collections::BTreeSet::new();
    source.iter().map(|q| {
        let id=q["id"].as_str().filter(|s|!s.is_empty()&&s.len()<=128&&ids.insert(s.to_string())).ok_or("INVALID_INPUT: invalid question identity")?;
        let title=q["question"].as_str().filter(|s|!s.trim().is_empty()&&s.len()<=8000).ok_or("INVALID_INPUT: invalid question")?;
        let options=q["options"].as_array().map(|options|options.iter().take(10).filter_map(|o|o["label"].as_str().filter(|s|s.len()<=1000).map(|s|json!(s))).collect::<Vec<_>>()).unwrap_or_default();
        Ok(json!({"id":id,"title":title,"options":options,"secret":q["isSecret"]==true}))
    }).collect()
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::capability_agent_runs::NativeIdentity;
    #[test]
    fn questions_are_bound_answered_once_and_invalidated_by_native_resolution() {
        let mut state=Interactions::default();let native=NativeIdentity{thread_id:"thread".into(),turn_id:Some("turn".into())};
        let question=json!({"id":7,"method":"item/tool/requestUserInput","params":{"threadId":"thread","turnId":"turn","questions":[{"id":"q","question":"Which title?","options":[{"label":"Notes"}]}]}});
        state.event(question.clone());let handle=state.questions(&native)[0]["handle"].as_str().unwrap().to_owned();
        let foreign=NativeIdentity{thread_id:"foreign".into(),turn_id:Some("turn".into())};
        assert!(state.questions(&foreign).is_empty());assert!(state.answer(&foreign,&handle,&json!(["Notes"])).is_err());
        assert!(state.answer(&native,&handle,&json!([])).is_err());
        let (id,answer)=state.answer(&native,&handle,&json!(["Notes"])).unwrap();assert_eq!(id,7);assert_eq!(answer,json!({"answers":{"q":{"answers":["Notes"]}}}));
        state.event(question);assert!(state.answer(&native,&handle,&json!(["Again"])).unwrap_err().starts_with("OUTCOME_UNKNOWN"));
        state.event(json!({"method":"serverRequest/resolved","params":{"requestId":7,"threadId":"thread"}}));assert!(state.questions(&native).is_empty());
        state.event(json!({"id":8,"method":"item/permissions/requestApproval","params":{"threadId":"thread","turnId":"turn"}}));
        let pending=state.questions(&native);assert_eq!(pending[0]["unsupported"],true);
        assert!(state.answer(&native,pending[0]["handle"].as_str().unwrap(),&json!([])).unwrap_err().starts_with("PERMISSION_DENIED"));
        state.observe(&native,&json!({"status":"inProgress","items":[{"type":"reasoning","text":"private"},{"type":"agentMessage","text":"Reading selected notes"}]}));
        assert_eq!(state.progress().unwrap(),json!({"text":"Reading selected notes","awaitingInput":true}));
        state.event(json!({"method":"workbench/disconnected"}));assert!(state.questions(&native).is_empty());assert!(state.progress().is_none());
    }
}
