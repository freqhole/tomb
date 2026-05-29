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

    // Validate the wordlist in data directory
    let result = ctx.run_json(&["wordlist", "validate", "../data/wordlist.txt"]);

    assert!(
        result["success"].as_bool().unwrap(),
        "Should validate wordlist successfully"
    );
}

#[test]
fn test_wordlist_stats() {
    let ctx = TestContext::from_snapshot();

    // Get wordlist statistics from data directory
    let result = ctx.run_json(&["wordlist", "stats", "../data/wordlist.txt"]);

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

    // Generate an invite code from the wordlist in data directory
    let result = ctx.run_json(&[
        "wordlist",
        "generate-code",
        "--word-count",
        "3",
        "--wordlist-file",
        "../data/wordlist.txt",
    ]);

    assert!(
        result["success"].as_bool().unwrap(),
        "Should generate code successfully"
    );

    let data = &result["data"];
    assert!(data["codes"].is_array(), "Should return array of codes");

    // Get the first code and verify it has 3 words separated by hyphens
    let codes = data["codes"].as_array().unwrap();
    assert!(!codes.is_empty(), "Should have at least one code");
    let code = codes[0].as_str().unwrap();
    assert_eq!(
        code.split('-').count(),
        4,
        "Code should have 3 words plus a digit segment"
    );
}
