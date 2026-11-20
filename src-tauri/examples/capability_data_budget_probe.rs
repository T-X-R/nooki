//! Disposable native data-budget experiment; never imported by the application.
#[path = "capability_runtime_probe/data_budget.rs"]
mod data_budget;
#[path = "capability_runtime_probe/data_budget_fixtures.rs"]
mod fixtures;

fn main() {
    println!("{}", serde_json::to_string_pretty(&fixtures::measure()).unwrap());
}
