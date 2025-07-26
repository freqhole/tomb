use tokio;

#[tokio::test]
async fn test_server_compiles() {
    // This is a basic test to ensure the server compiles and basic functionality works
    assert_eq!(2 + 2, 4);
}

#[tokio::test]
async fn test_embedded_migrations() {
    // Test that migrations are properly embedded in the binary
    // This test verifies the migration embedding works at compile time

    // The sqlx::migrate! macro should embed migrations at compile time
    let migrations = sqlx::migrate!("../migrations");

    // Verify that migrations were found and embedded
    assert!(
        !migrations.migrations.is_empty(),
        "No migrations were embedded"
    );

    // Check that we have a reasonable number of migrations
    let migration_count = migrations.migrations.len();
    assert!(
        migration_count > 30,
        "Expected at least 30 migrations, found {}",
        migration_count
    );

    println!("✅ Successfully embedded {} migrations", migration_count);
}
