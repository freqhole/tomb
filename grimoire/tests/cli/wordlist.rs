//! Wordlist CLI integration tests

use crate::TestContext;

#[test]
fn test_wordlist_generate() {
    let ctx = TestContext::from_snapshot();

    // Generate a wordlist
    let result = ctx.run_json(&[
        "wordlist",
        "generate",
        "--count",
        "100",
        "--include-silly",
        "--include-animals",
        "--include-food",
        "--mixed",
    ]);

    assert!(
        result["success"].as_bool().unwrap(),
        "Should generate wordlist successfully"
    );
}

#[test]
fn test_wordlist_validate() {
    let ctx = TestContext::from_snapshot();

    // Validate the wordlist (assumes wordlist exists)
    let result = ctx.run_json(&["wordlist", "validate"]);

    assert!(
        result["success"].as_bool().unwrap(),
        "Should validate wordlist successfully"
    );
}

#[test]
fn test_wordlist_stats() {
    let ctx = TestContext::from_snapshot();

    // Get wordlist statistics
    let result = ctx.run_json(&["wordlist", "stats"]);

    assert!(
        result["success"].as_bool().unwrap(),
        "Should get wordlist stats successfully"
    );

    let data = &result["data"];
    assert!(
        data["word_count"].is_number() || data["total_words"].is_number(),
        "Should have word count"
    );
}

#[test]
fn test_wordlist_generate_code() {
    let ctx = TestContext::from_snapshot();

    // Generate an invite code from the wordlist
    let result = ctx.run_json(&["wordlist", "generate-code", "--word-count", "3"]);

    assert!(
        result["success"].as_bool().unwrap(),
        "Should generate code successfully"
    );

    let data = &result["data"];
    assert!(data["code"].is_string(), "Should return generated code");

    // Code should have 3 words separated by hyphens
    let code = data["code"].as_str().unwrap();
    assert_eq!(code.split('-').count(), 3, "Code should have 3 words");
}
