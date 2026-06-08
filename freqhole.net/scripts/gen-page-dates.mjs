// stamps each docs .mdx with `created`, `createdBy`, `updated`, and `updatedBy`
// frontmatter, derived from git history. keeping the dates in frontmatter
// (rather than a json sidecar) means a human can read or hand-edit them, and
// the astro build just reads ordinary frontmatter - no git needed at build time
// (cloudflare pages shallow-clones, so git history isn't available there; run
// this locally or in the version-packages job, which has full history, and
// commit it).
//
// idempotent:
//   - `created`, `createdBy`, `createdSha` are write-once: set the first time a
//     page is stamped, then left alone (hand-edit them, or pass --force, if you
//     ever need to correct them).
//   - `updated`, `updatedBy`, `updatedSha` always refresh from the latest *real*
//     commit that touched the file. the generator's own commits are skipped
//     (see isBot), so stamping a file never makes the next run credit the bot.
//
// usage:
//   node scripts/gen-page-dates.mjs           # stamp frontmatter in place
//   node scripts/gen-page-dates.mjs --check    # exit 1 if any file would change
//   node scripts/gen-page-dates.mjs --force    # rewrite every field, even pinned

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, statSync, readdirSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const siteRoot = join(here, "..");
const docsDir = join(siteRoot, "src", "content", "docs");

// field + record separators that won't appear in commit metadata.
const FS = "\x1f";
const RS = "\x1e";
const FMT = ["%aI", "%an", "%ae", "%H"].join(FS); // author date (iso), name, email, sha

// commits made by the date generator / release automation. their changes to a
// page are just timestamp bumps, so they must not count as the "last real"
// edit, otherwise every page would end up credited to the bot. real github
// web-ui / squash commits also use a users.noreply address, so we only treat a
// commit as a bot commit when its author name is literally the actions bot.
const isBot = (name, email) =>
  /github-actions\[bot\]/i.test(name) || /github-actions\[bot\]/i.test(email);

const isCheck = process.argv.includes("--check");
// --force re-stamps even the write-once fields (created/createdBy/createdSha),
// rebuilding every page's metadata from scratch. otherwise those are pinned.
const isForce = process.argv.includes("--force");

// repo slug (owner/name) + optional token, used to resolve a commit's sha to
// the github login that authored it (so the byline can show a profile + avatar
// even when the commit email isn't a github noreply address). best-effort: runs
// fine offline/unauthenticated, just without api-resolved logins.
const REPO = repoSlug();
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";

// recursively collect .mdx files, skipping the splash home page (index.mdx),
// which renders no page title and has no business showing edit timestamps.
function collectMdx(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectMdx(full));
    } else if (entry.name.endsWith(".mdx") && full !== join(docsDir, "index.mdx")) {
      out.push(full);
    }
  }
  return out;
}

function git(args) {
  try {
    return execFileSync("git", args, { cwd: siteRoot, encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function parseRecord(line) {
  if (!line) return null;
  const [date, name, email, sha] = line.split(FS);
  if (!date) return null;
  // keep the full iso timestamp (with offset) so the byline can show a
  // rounded time of day, not just the date; short sha links to the commit.
  return { date, name: name || "", email: email || "", sha: (sha || "").slice(0, 7) };
}

// first commit that added the file (oldest add across renames).
function firstCommit(file) {
  const out = git(["log", "--follow", "--diff-filter=A", `--format=${FMT}${RS}`, "--", file]);
  if (!out) return null;
  const records = out.split(RS).map((s) => s.trim()).filter(Boolean);
  return parseRecord(records[records.length - 1]);
}

// most recent commit touching the file, skipping bump-bot commits. falls back
// to the newest commit of any kind if every touch was a bot commit.
function lastRealCommit(file) {
  const out = git(["log", `--format=${FMT}${RS}`, "--", file]);
  if (!out) return null;
  const records = out.split(RS).map((s) => s.trim()).filter(Boolean).map(parseRecord);
  return records.find((r) => r && !isBot(r.name, r.email)) ?? records[0] ?? null;
}

// derive the github repo slug (owner/name) from the origin remote, for commit
// urls + the api lookups. falls back to the known repo if the remote is absent.
function repoSlug() {
  const url = git(["config", "--get", "remote.origin.url"]);
  const m = url.match(/github\.com[:/](.+?)(?:\.git)?$/);
  return m ? m[1] : "freqhole/tomb";
}

// resolve the github login that authored a commit sha, via the api. cached per
// sha; returns null on any failure (offline, rate-limited, unknown author).
const loginCache = new Map();
async function resolveLogin(sha) {
  if (!sha) return null;
  if (loginCache.has(sha)) return loginCache.get(sha);
  let login = null;
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/commits/${sha}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "freqhole-gen-page-dates",
        ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
      },
    });
    if (res.ok) {
      const json = await res.json();
      login = json?.author?.login ?? null;
    }
  } catch {
    // network unavailable - leave login null, fall back to the commit name.
  }
  loginCache.set(sha, login);
  return login;
}

// the author we stamp: prefer a github login (from a noreply email, else an api
// lookup by sha) so the component can render a profile + avatar; otherwise the
// plain commit author name.
async function resolveAuthor(commit) {
  if (!commit) return "unknown";
  const noreply = (commit.email || "").toLowerCase().match(/^(?:\d+\+)?([^@]+)@users\.noreply\.github\.com$/);
  if (noreply) return noreply[1];
  const login = await resolveLogin(commit.sha);
  return login || commit.name || "unknown";
}

// last resort when a file isn't committed yet: filesystem timestamps.
function fsDates(file) {
  const st = statSync(file);
  return {
    created: st.birthtime.toISOString(),
    updated: st.mtime.toISOString(),
    createdBy: "local",
    updatedBy: "local",
    createdSha: "",
    updatedSha: "",
  };
}

// ---- frontmatter editing (scalar keys only) -------------------------------

function splitFrontmatter(content) {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/);
  if (!m) return null;
  return { block: m[1], rest: content.slice(m[0].length), raw: m[0] };
}

// set a scalar key in a frontmatter block. pin=true leaves an existing value
// untouched. returns the (possibly unchanged) block text.
function setScalar(block, key, rendered, pin) {
  const lineRe = new RegExp(`^${key}:.*$`, "m");
  if (lineRe.test(block)) {
    return pin ? block : block.replace(lineRe, rendered);
  }
  return block.replace(/\s*$/, "") + "\n" + rendered;
}

const yamlString = (s) => `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

let changed = 0;
const stale = [];

for (const file of collectMdx(docsDir).sort()) {
  const content = readFileSync(file, "utf8");
  const fm = splitFrontmatter(content);
  if (!fm) {
    console.warn(`skipping (no frontmatter): ${relative(siteRoot, file)}`);
    continue;
  }

  const first = firstCommit(file);
  const last = lastRealCommit(file);
  const dates = first || last ? null : fsDates(file);

  const createSrc = first ?? last;
  const updateSrc = last ?? first;

  const created = dates?.created ?? createSrc.date;
  const updated = dates?.updated ?? updateSrc.date;
  const createdSha = dates?.createdSha ?? createSrc.sha;
  const updatedSha = dates?.updatedSha ?? updateSrc.sha;
  // createdBy is pinned from the commit that added the page; updatedBy tracks
  // the latest real edit. they differ when one person creates a page and
  // another later edits it.
  const createdBy = dates?.createdBy ?? (await resolveAuthor(createSrc));
  const updatedBy = dates?.updatedBy ?? (await resolveAuthor(updateSrc));

  // create-side fields are write-once (pinned) unless --force rewrites all.
  const pinCreate = !isForce;

  let block = fm.block;
  block = setScalar(block, "created", `created: ${created}`, pinCreate);
  block = setScalar(block, "createdBy", `createdBy: ${yamlString(createdBy)}`, pinCreate);
  block = setScalar(block, "createdSha", `createdSha: ${yamlString(createdSha)}`, pinCreate);
  block = setScalar(block, "updated", `updated: ${updated}`, false);
  block = setScalar(block, "updatedBy", `updatedBy: ${yamlString(updatedBy)}`, false);
  block = setScalar(block, "updatedSha", `updatedSha: ${yamlString(updatedSha)}`, false);

  const nextContent = `---\n${block}\n---\n` + fm.rest;
  if (nextContent !== content) {
    stale.push(relative(siteRoot, file));
    if (!isCheck) {
      writeFileSync(file, nextContent);
      changed++;
    }
  }
}

if (isCheck) {
  if (stale.length) {
    console.error("frontmatter dates are stale. run: npm run gen:dates\n  " + stale.join("\n  "));
    process.exit(1);
  }
  console.log("frontmatter dates are up to date.");
} else {
  console.log(`stamped ${changed} file(s).`);
}

