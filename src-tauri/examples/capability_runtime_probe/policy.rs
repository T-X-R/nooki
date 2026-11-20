pub const MAX_MESSAGE_BYTES: usize = 65_536;

pub fn authorize(caller: &str, claimed: &str, bytes: usize) -> Result<(), &'static str> {
    if !["probe-shell", "probe-a", "probe-b", "probe-control"].contains(&caller) || caller != claimed {
        return Err("caller mismatch");
    }
    if bytes > MAX_MESSAGE_BYTES { return Err("message budget exceeded"); }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn caller_identity_and_message_budget_are_not_controlled_by_the_payload() {
        assert!(authorize("probe-a", "probe-a", MAX_MESSAGE_BYTES).is_ok());
        assert!(authorize("probe-a", "probe-shell", 1).is_err());
        assert!(authorize("unknown", "unknown", 1).is_err());
        assert!(authorize("probe-a", "probe-a", MAX_MESSAGE_BYTES + 1).is_err());
    }
}
