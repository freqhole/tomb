//! blobz CLI integration tests

use crate::TestContext;

#[test]
fn test_blobz_blake3_status_reports_total_and_split() {
    let ctx = TestContext::from_snapshot();

    let result = ctx.run_json(&["blobz", "blake3-status"]);

    assert!(result["success"].as_bool().unwrap());

    let total = result["data"]["total_blobs"].as_i64().unwrap();
    let with_blake3 = result["data"]["with_blake3"].as_i64().unwrap();
    let needing_blake3 = result["data"]["needing_blake3"].as_i64().unwrap();

    assert!(total > 0, "test db should have media blob rows");
    assert_eq!(
        total,
        with_blake3 + needing_blake3,
        "with_blake3 + needing_blake3 should account for every row"
    );
}
