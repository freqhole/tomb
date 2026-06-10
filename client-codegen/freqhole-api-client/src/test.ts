// main test runner
import { validateWrapperCoverage } from "./test/coverage.js";
import { runIntegrationTests } from "./test/integration.js";
import { runStatefulTests } from "./test/stateful.js";
import { runPlaylistzTests } from "./test/playlistz.js";
import { runAutomergeTests } from "./test/automerge.js";
import { runStorageTests } from "./test/storage.js";

async function main() {
  console.log("freqhole api client test suite\n");
  console.log("=".repeat(50));
  console.log("");

  let totalPassed = 0;
  let totalFailed = 0;

  // always run wrapper coverage validation
  const coverageResults = await validateWrapperCoverage();
  totalPassed += coverageResults.passed;
  totalFailed += coverageResults.failed;

  console.log("=".repeat(50));
  console.log("");

  // always run playlistz domain tests (pure - no server needed)
  const playlistzResults = await runPlaylistzTests();
  totalPassed += playlistzResults.passed;
  totalFailed += playlistzResults.failed;

  console.log("=".repeat(50));
  console.log("");

  // automerge adapter unit tests (no server required)
  const automergeResults = await runAutomergeTests();
  totalPassed += automergeResults.passed;
  totalFailed += automergeResults.failed;

  console.log("=".repeat(50));
  console.log("");

  // run storage unit tests (no server required)
  const storageResults = await runStorageTests();
  totalPassed += storageResults.passed;
  totalFailed += storageResults.failed;

  console.log("=".repeat(50));
  console.log("");

  // run integration tests if not skipped
  if (process.env.SKIP_INTEGRATION !== "true") {
    const integrationResults = await runIntegrationTests();
    totalPassed += integrationResults.passed;
    totalFailed += integrationResults.failed;

    console.log("=".repeat(50));
    console.log("");

    // run stateful tests (create/update/delete real entities)
    const statefulResults = await runStatefulTests();
    totalPassed += statefulResults.passed;
    totalFailed += statefulResults.failed;
  } else {
    console.log("⚠ skipping integration tests (SKIP_INTEGRATION=true)\n");
  }

  // summary
  console.log("=".repeat(50));
  console.log(`\ntotal: ${totalPassed} passed, ${totalFailed} failed\n`);

  if (typeof process !== "undefined") {
    process.exit(totalFailed > 0 ? 1 : 0);
  }
}

main().catch(console.error);
