pub const MAX_MESSAGE_BYTES: usize = 65_536;

pub fn command_allowed(caller: &str, command: &str) -> bool {
    match caller {
        "probe-shell" | "probe-control" => true,
        "probe-a" | "probe-b" => matches!(command, "probe_rpc" | "probe_identity" | "probe_report" | "probe_tick"),
        _ => false,
    }
}

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
    fn packages_cannot_reach_unlisted_application_commands() {
        for caller in ["probe-a", "probe-b"] {
            for allowed in ["probe_rpc", "probe_identity", "probe_report", "probe_tick"] {
                assert!(command_allowed(caller, allowed));
            }
            for denied in ["probe_unguarded", "probe_host_secret", "probe_control", "future_command"] {
                assert!(!command_allowed(caller, denied), "{caller} reached {denied}");
            }
        }
        assert!(command_allowed("probe-shell", "probe_control"));
        assert!(command_allowed("probe-control", "probe_unguarded"));
        assert!(!command_allowed("unknown", "probe_rpc"));
    }

    #[test]
    fn caller_identity_and_message_budget_are_not_controlled_by_the_payload() {
        assert!(authorize("probe-a", "probe-a", MAX_MESSAGE_BYTES).is_ok());
        assert!(authorize("probe-a", "probe-shell", 1).is_err());
        assert!(authorize("unknown", "unknown", 1).is_err());
        assert!(authorize("probe-a", "probe-a", MAX_MESSAGE_BYTES + 1).is_err());
    }
}
