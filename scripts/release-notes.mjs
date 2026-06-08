#!/usr/bin/env node
// build + apply the github release body for a tag by combining the changeset
// changelog (human-written "what changed") with github's auto-generated notes
// (the commit/PR list). used in two places:
//   - release.yml create-release: set the draft body when the version PR opens,
//     so the changelog shows up in the draft immediately.
//   - release-publish.mjs: refresh the body right before flipping draft ->
//     published (the changelog may have changed if the PR was updated).
//
// the changeset section goes first; the generated notes follow under a divider.
// the generated portion is produced fresh via the generate-notes api on every
// call, so re-runs replace (never stack) the body.
//
// usage: node scripts/release-notes.mjs <tag>   (e.g. v0.1.29)
// requires the `gh` cli with GH_TOKEN / GITHUB_TOKEN in the environment.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function gh(args) {
  return execFileSync("gh", args, {
    cwd: root,
    stdio: ["ignore", "pipe", "inherit"],
  })
    .toString()
    .trim();
}

// pull the changelog section for `version` out of CHANGELOG.md. changesets
// writes one `## <version>` heading per release, so we grab everything between
// this version's heading and the next `## ` heading. returns "" if not found.
export function changelogSection(version) {
  let text;
  try {
    text = readFileSync(join(root, "CHANGELOG.md"), "utf8");
  } catch {
    return "";
  }
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.trim() === `## ${version}`);
  if (start === -1) return "";
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith("## ")) {
      end = i;
      break;
    }
  }
  // drop the `## <version>` heading itself; keep the body (### Patch Changes ...).
  return lines
    .slice(start + 1, end)
    .join("\n")
    .trim();
}

// generate github's auto notes (commit/PR list) for a tag without persisting
// them. works before the tag exists by basing them on the target branch.
// returns "" if the api call fails (e.g. first release, nothing to compare).
function generatedNotes(tag) {
  try {
    return gh([
      "api",
      "repos/{owner}/{repo}/releases/generate-notes",
      "-f",
      `tag_name=${tag}`,
      "-f",
      "target_commitish=main",
      "--jq",
      ".body",
    ]).trim();
  } catch {
    return "";
  }
}

// set the release body for `tag` to changeset changelog + generated notes.
// no-ops (leaving the existing body) when there's no changelog section for the
// version. returns true if it set the notes, false if it left them as-is.
export function applyReleaseNotes(tag) {
  const version = tag.replace(/^v/, "");
  const changes = changelogSection(version);
  if (!changes) {
    console.log(`no CHANGELOG.md section for ${version}; keeping existing notes`);
    return false;
  }
  const generated = generatedNotes(tag);
  const body = generated ? `${changes}\n\n---\n\n${generated}` : changes;
  console.log(`setting release notes for ${tag} from CHANGELOG.md`);
  gh(["release", "edit", tag, "--notes", body]);
  return true;
}

// run as a cli: node scripts/release-notes.mjs <tag>
if (import.meta.url === `file://${process.argv[1]}`) {
  const tag = process.argv[2];
  if (!tag) {
    console.error("usage: node scripts/release-notes.mjs <tag>");
    process.exit(1);
  }
  applyReleaseNotes(tag);
}
