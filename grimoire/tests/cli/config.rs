//! Config CLI integration tests

use crate::TestContext;

#[test]
fn test_config_validate() {
    let ctx = TestContext::from_snapshot();

    // Validate the test config file
    let result = ctx.run_json(&["config", "validate"]);

    assert!(
        result["success"].as_bool().unwrap(),
        "Should validate config successfully"
    );
    assert!(
        result["data"]["valid"].as_bool().unwrap(),
        "Config should be valid"
    );
}
