//! Host validation of the final result against the immutable approved schema.
use crate::capability_agent_runs::Outcome;
use serde_json::Value;
fn validator(schema:&Value)->Result<jsonschema::Validator,String> {
    if !schema.is_object() || serde_json::to_vec(schema).map_err(|_|"INVALID_INPUT: invalid result schema")?.len()>16_384
        || schema.get("$schema").is_some_and(|s|!matches!(s.as_str(),Some("https://json-schema.org/draft/2020-12/schema"|"https://json-schema.org/draft/2020-12/schema#"))) {
        return Err("INVALID_INPUT: result schema must use JSON Schema 2020-12 and fit 16 KiB".into());
    }
    jsonschema::options().with_draft(jsonschema::Draft::Draft202012).offline()
        .with_pattern_options(jsonschema::PatternOptions::regex()).should_validate_formats(true).should_ignore_unknown_formats(false)
        .build(schema).map_err(|_|"INVALID_INPUT: invalid or unsupported result schema; external references are unavailable".into())
}
pub(crate) fn check_schema(schema:Option<&Value>)->Result<(),String>{
    if let Some(schema)=schema {validator(schema)?;}Ok(())
}
pub(crate) fn validate(schema:Option<&Value>,outcome:&Outcome)->Outcome {
    let text=match outcome {Outcome::Completed{text}|Outcome::Structured{text,..}=>text,_=>return outcome.clone()};
    if text.trim().is_empty()||text.len()>1_000_000{return Outcome::InvalidResult;}
    let Some(schema)=schema else{return Outcome::Completed{text:text.clone()}};
    let Ok(data)=serde_json::from_str::<Value>(text) else{return Outcome::InvalidResult};
    let Ok(validator)=validator(schema) else{return Outcome::InvalidResult};
    if !validator.is_valid(&data){return Outcome::InvalidResult;}
    Outcome::Structured{text:text.clone(),data}
}
/// A commentary message is progress, not a completed answer (especially when the answer is JSON).
pub(crate) fn final_message(turn:&Value)->Outcome {
    let text=turn["items"].as_array().into_iter().flatten().rev()
        .find(|item|item["type"]=="agentMessage"&&item["phase"]!="commentary")
        .and_then(|item|item["text"].as_str()).unwrap_or("").to_string();
    validate(None,&Outcome::Completed{text})
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn final_answer_excludes_commentary_and_validates_local_schema_references() {
        let outcome=final_message(&json!({"items":[{"type":"agentMessage","phase":"commentary","text":"Preparing notes"},{"type":"agentMessage","phase":"final_answer","text":"{\"summary\":\"Ready\"}"}]}));
        let schema=json!({"type":"object","properties":{"summary":{"$ref":"#/$defs/text"}},"required":["summary"],"additionalProperties":false,"$defs":{"text":{"type":"string","minLength":1}}});
        assert!(matches!(validate(Some(&schema),&outcome),Outcome::Structured{data,..} if data["summary"]=="Ready"));
        assert!(matches!(final_message(&json!({"items":[{"type":"agentMessage","phase":"commentary","text":"Still working"}]})),Outcome::InvalidResult));
        assert!(check_schema(Some(&json!({"type":"string","pattern":"(?=unbounded)"}))).is_err());
    }
}
