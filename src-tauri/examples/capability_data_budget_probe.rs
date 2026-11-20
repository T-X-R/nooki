//! Disposable native data-budget experiment; never imported by the application.
#[path = "capability_runtime_probe/data_budget.rs"]
mod data_budget;
#[path = "capability_runtime_probe/data_budget_fixtures.rs"]
mod fixtures;
#[path = "capability_runtime_probe/retained_fixtures.rs"]
mod retained_fixtures;
#[path = "capability_runtime_probe/live_resources.rs"]
mod live_resources;

#[tokio::main(flavor = "current_thread")]
async fn main() {
    println!("{}", serde_json::to_string_pretty(&serde_json::json!({"data":fixtures::measure(), "retained":retained_fixtures::measure().await})).unwrap());
}
