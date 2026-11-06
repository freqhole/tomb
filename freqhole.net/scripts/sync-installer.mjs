// keep the public download identical to the maintained Pi installer.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = new URL("../../scripts/raspberry-pi/setup.sh", import.meta.url);
const target = new URL("../public/setup.sh", import.meta.url);
const content = readFileSync(source);

if (process.argv.includes("--check")) {
  if (!content.equals(readFileSync(target))) {
    console.error("hosted installer is stale. run: npm run gen:installer");
    process.exit(1);
  }
} else {
  writeFileSync(target, content);
  console.log(`synced ${fileURLToPath(target)}`);
}
