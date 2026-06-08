// generate mermaid schema diagrams for the "the database" docs page.
//
// this introspects two sources of truth and writes mermaid `erDiagram` blocks
// into src/content/docs/concepts/database.mdx between sentinel markers:
//
//   1. the server-side SQLite schema, built from tomb/migrations/*.sql into a
//      throwaway db (pure sqlite3 cli, no sqlx-cli needed). tables are grouped
//      into logical domains and foreign keys become relationships.
//   2. the client-side IndexedDB schema used by spume, parsed from the `idb`
//      createObjectStore/createIndex calls in the spume source.
//
// re-run after a schema change with `npm run gen:schema` (from freqhole.net/).
// only the regions between the `{/* gen:*:start */}` / `{/* gen:*:end */}`
// markers are rewritten, so hand-written prose around them is preserved.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const siteRoot = resolve(__dirname, "..");
const repoRoot = resolve(siteRoot, "..");
const migrationsDir = join(repoRoot, "migrations");
const spumeSrc = join(repoRoot, "client", "spume", "src");
const pagePath = join(siteRoot, "src", "content", "docs", "concepts", "database.mdx");

// ---- SQLite: logical grouping of tables into domains ----------------------
// any base table not listed here lands in an automatically-appended "other"
// domain, so nothing is silently dropped when new tables are added.
const SQLITE_DOMAINS = [
  {
    title: "music catalog",
    tables: [
      "media_blobz",
      "artistz",
      "albumz",
      "songz",
      "artist_albumz",
      "artist_songz",
      "album_songz",
      "related_artistz",
    ],
  },
  {
    title: "taxonomy + tags",
    tables: [
      "tagz",
      "album_tagz",
      "taxon_kindz",
      "taxonz",
      "taxon_parentz",
      "album_taxonz",
      "scalar_attributez",
    ],
  },
  {
    title: "playlists",
    tables: ["playlistz", "playlist_songz"],
  },
  {
    title: "images + links",
    tables: [
      "artist_imagez",
      "album_imagez",
      "song_imagez",
      "playlist_imagez",
      "entity_urlz",
    ],
  },
  {
    title: "users, auth + sessions",
    tables: [
      "user_accountz",
      "user_credentialz",
      "invite_codez",
      "user_favoritez",
      "user_ratingz",
      "tower_sessions",
    ],
  },
  {
    title: "radio",
    tables: [
      "radio_stationz",
      "radio_station_filterz",
      "radio_play_historyz",
      "radio_bumperz",
    ],
  },
  {
    title: "listening + feed",
    tables: [
      "listen_sessionz",
      "music_play_eventz",
      "media_eventz",
      "feed_eventz",
    ],
  },
  {
    title: "federation + p2p",
    tables: ["remotez", "user_peer_nodez", "knock_requestz"],
  },
  {
    title: "scanning + jobs",
    tables: [
      "scanned_directories",
      "directory_tag_rules",
      "scan_cache",
      "jobz",
      "job_sessionz",
    ],
  },
];

// ---- IndexedDB: spume's three idb databases -------------------------------
// stores + indexes are parsed from source; the cross-store relationships are
// curated here (they derive from record-shape fields like song.album_id that
// are not introspectable from createObjectStore). update this list if the
// record shapes change.
const IDB_DATABASES = [
  {
    initFile: join(spumeSrc, "app", "services", "storage", "db.ts"),
    constFiles: [join(spumeSrc, "app", "services", "storage", "types.ts")],
    nameConst: "APP_DB_NAME",
    versionConst: "APP_DB_VERSION",
    relationships: [],
  },
  {
    initFile: join(spumeSrc, "music", "services", "storage", "db", "init.ts"),
    constFiles: [join(spumeSrc, "music", "services", "storage", "types.ts")],
    nameConst: "MUSIC_DB_NAME",
    versionConst: "MUSIC_DB_VERSION",
    // split this db's stores into smaller diagrams so they stay readable.
    // any store not listed lands in an automatic "other" group.
    domains: [
      { title: "catalog", stores: ["artists", "albums", "songs", "genres"] },
      { title: "playlists", stores: ["playlists", "playlist_songs"] },
      { title: "tags + taxonomy", stores: ["tags", "album_tags", "taxons", "album_taxons"] },
      { title: "user library", stores: ["favorites", "ratings"] },
    ],
    relationships: [
      ["artists", "albums", "artist_id"],
      ["artists", "songs", "artist_id"],
      ["albums", "songs", "album_id"],
      ["genres", "albums", "genre_id"],
      ["genres", "genres", "parent_genre_id"],
      ["playlists", "playlist_songs", "playlist_id"],
      ["songs", "playlist_songs", "song_id"],
      ["albums", "album_tags", "album_id"],
      ["tags", "album_tags", "tag_id"],
      ["albums", "album_taxons", "album_id"],
      ["taxons", "album_taxons", "taxon_id"],
    ],
  },
  {
    initFile: join(spumeSrc, "music", "services", "storage", "blobs.ts"),
    constFiles: [],
    nameConst: "BLOB_DB_NAME",
    versionConst: "BLOB_DB_VERSION",
    relationships: [],
  },
];

// ---------------------------------------------------------------------------
// SQLite introspection
// ---------------------------------------------------------------------------

function buildSqliteSchema() {
  const dir = mkdtempSync(join(tmpdir(), "freqhole-schema-"));
  const dbPath = join(dir, "schema.db");
  const sqlPath = join(dir, "all.sql");

  // FTS5 tables make the sqlite3 cli reject later ALTER/DROP on their base
  // tables unless trusted_schema is on. concatenate every migration (in
  // numeric order) behind that pragma and apply in one shot.
  const files = listSql(migrationsDir).sort();
  const parts = ["PRAGMA trusted_schema=ON;"];
  for (const f of files) {
    parts.push(readFileSync(f, "utf8"));
    parts.push(";");
  }
  writeFileSync(sqlPath, parts.join("\n"));
  execFileSync("sqlite3", [dbPath], { input: readFileSync(sqlPath, "utf8") });

  const tables = q(dbPath, `
    SELECT name FROM sqlite_master
    WHERE type='table' AND name NOT LIKE '%\\_fts%' ESCAPE '\\'
      AND name NOT LIKE 'sqlite_%'
    ORDER BY name;
  `).map((r) => r.name);

  const ftsBacked = new Set(
    q(dbPath, `SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%\\_fts' ESCAPE '\\';`)
      .map((r) => r.name.replace(/_fts$/, "")),
  );

  const schema = {};
  for (const t of tables) {
    const cols = q(dbPath, `SELECT name, type, pk FROM pragma_table_info('${t}');`);
    const fks = q(dbPath, `SELECT "from" AS col, "table" AS ref_table, "to" AS ref_col FROM pragma_foreign_key_list('${t}');`);
    schema[t] = { cols, fks, fts: ftsBacked.has(t) };
  }

  rmSync(dir, { recursive: true, force: true });
  return { schema };
}


function listSql(dir) {
  // numeric migrations only (skip the views/ subdir and dotfiles).
  return execFileSync("ls", ["-1", dir], { encoding: "utf8" })
    .split("\n")
    .filter((n) => /^\d+.*\.sql$/.test(n))
    .map((n) => join(dir, n));
}

function q(dbPath, sql) {
  const out = execFileSync("sqlite3", ["-json", dbPath, sql.trim()], { encoding: "utf8" }).trim();
  return out ? JSON.parse(out) : [];
}

function renderSqlite(schema) {
  const placed = new Set();
  const domains = SQLITE_DOMAINS.map((d) => ({
    title: d.title,
    tables: d.tables.filter((t) => schema[t]),
  }));
  for (const d of domains) for (const t of d.tables) placed.add(t);

  const leftover = Object.keys(schema).filter((t) => !placed.has(t)).sort();
  if (leftover.length) domains.push({ title: "other", tables: leftover });

  const out = [];
  for (const d of domains) {
    if (!d.tables.length) continue;
    const inDomain = new Set(d.tables);
    out.push(`#### ${d.title}`, "");
    out.push("```mermaid", "erDiagram");

    for (const t of d.tables) {
      const { cols, fks } = schema[t];
      const fkCols = new Set(fks.map((f) => f.col));
      out.push(`  ${t} {`);
      for (const c of cols) {
        const type = (c.type || "ANY").replace(/\s+/g, "_");
        const key = c.pk ? " PK" : fkCols.has(c.col ?? c.name) ? " FK" : "";
        out.push(`    ${type} ${c.name}${key}`);
      }
      out.push("  }");
    }

    // one relationship per fk whose child lives in this domain.
    for (const t of d.tables) {
      for (const fk of schema[t].fks) {
        if (!schema[fk.ref_table]) continue;
        const label = inDomain.has(fk.ref_table)
          ? fk.col
          : `${fk.col} (-> ${fk.ref_table})`;
        out.push(`  ${fk.ref_table} ||--o{ ${t} : "${label}"`);
      }
    }

    out.push("```", "");
  }

  const ftsTables = Object.keys(schema).filter((t) => schema[t].fts).sort();
  if (ftsTables.length) {
    out.push(
      `_full-text search mirrors (FTS5): ${ftsTables.map((t) => `\`${t}\``).join(", ")} each have a companion \`${"<table>"}_fts\` virtual table kept in sync by triggers._`,
      "",
    );
  }

  return out.join("\n").trimEnd();
}


function collectConsts(files) {
  const map = {};
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/(?:export\s+)?const\s+(\w+)\s*=\s*"([^"]+)"/g)) {
      map[m[1]] = m[2];
    }
    for (const m of src.matchAll(/(?:export\s+)?const\s+(\w+)\s*=\s*(\d+)\b/g)) {
      if (!(m[1] in map)) map[m[1]] = Number(m[2]);
    }
  }
  return map;
}

function resolveStore(token, consts) {
  const t = token.trim();
  if (t.startsWith('"') || t.startsWith("'")) return t.slice(1, -1);
  return consts[t] ?? t;
}

function parseIdb(db) {
  const consts = collectConsts([db.initFile, ...db.constFiles]);
  const src = readFileSync(db.initFile, "utf8");

  // createObjectStore(STORE, { keyPath: ..., autoIncrement: ... }), optionally
  // captured into a `const xStore = ...` so its indexes can be attached.
  const stores = [];
  const varToStore = {};
  const reStore =
    /(?:const\s+(\w+)\s*=\s*)?db\.createObjectStore\(\s*([A-Za-z0-9_"']+)\s*,\s*\{([^}]*)\}\s*\)/g;
  for (const m of src.matchAll(reStore)) {
    const [, varName, token, opts] = m;
    const name = resolveStore(token, consts);
    const kp = opts.match(/keyPath:\s*("[^"]+"|'[^']+'|\[[^\]]*\])/);
    const auto = /autoIncrement:\s*true/.test(opts);
    const store = { name, keyPath: kp ? kp[1] : null, autoIncrement: auto, indexes: [] };
    stores.push(store);
    if (varName) varToStore[varName] = store;
  }

  // <var>.createIndex("name", keyPath, { unique, multiEntry })
  const reIndex =
    /(\w+)\.createIndex\(\s*"([^"]+)"\s*,\s*("[^"]+"|'[^']+'|\[[^\]]*\])\s*(?:,\s*\{([^}]*)\})?\s*\)/g;
  for (const m of src.matchAll(reIndex)) {
    const [, varName, idxName, keyPath, opts = ""] = m;
    const store = varToStore[varName];
    if (!store) continue;
    store.indexes.push({
      name: idxName,
      keyPath: keyPath.replace(/['"]/g, ""),
      unique: /unique:\s*true/.test(opts),
      multiEntry: /multiEntry:\s*true/.test(opts),
    });
  }

  return {
    name: consts[db.nameConst] ?? db.nameConst,
    version: consts[db.versionConst] ?? "?",
    stores,
    relationships: db.relationships,
    domains: db.domains,
  };
}

function sanitize(s) {
  return s.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "") || "key";
}

function renderIdb(dbs) {
  const out = [];
  for (const db of dbs) {
    // group stores into smaller diagrams when a db declares domains, otherwise
    // render all of its stores in a single diagram.
    let groups;
    if (db.domains && db.domains.length) {
      const placed = new Set();
      groups = db.domains.map((d) => ({
        title: d.title,
        stores: d.stores.filter((name) => db.stores.some((s) => s.name === name)),
      }));
      for (const g of groups) for (const s of g.stores) placed.add(s);
      const leftover = db.stores.map((s) => s.name).filter((n) => !placed.has(n));
      if (leftover.length) groups.push({ title: "other", stores: leftover });
    } else {
      groups = [{ title: null, stores: db.stores.map((s) => s.name) }];
    }

    for (const g of groups) {
      if (!g.stores.length) continue;
      const inGroup = new Set(g.stores);
      const heading = g.title
        ? `#### \`${db.name}\` · ${g.title} (v${db.version})`
        : `#### \`${db.name}\` (v${db.version})`;
      out.push(heading, "");
      out.push("```mermaid", "erDiagram");

      for (const name of g.stores) {
        const s = db.stores.find((x) => x.name === name);
        if (!s) continue;
        out.push(`  ${s.name} {`);
        if (s.keyPath) {
          const raw = s.keyPath.replace(/['"]/g, "");
          out.push(`    key ${sanitize(raw)} PK "${raw}${s.autoIncrement ? ", auto" : ""}"`);
        } else {
          out.push(`    key out_of_line PK "auto-increment"`);
        }
        for (const idx of s.indexes) {
          const marker = idx.unique ? " UK" : "";
          const note = [idx.keyPath, idx.multiEntry ? "multiEntry" : ""].filter(Boolean).join(", ");
          out.push(`    index ${idx.name}${marker} "${note}"`);
        }
        out.push("  }");
      }

      // emit a relationship in the group that owns the child; annotate the
      // parent when it lives in another group (mirrors the SQLite renderer).
      for (const [parent, child, label] of db.relationships) {
        if (!inGroup.has(child)) continue;
        const full = inGroup.has(parent) ? label : `${label} (-> ${parent})`;
        out.push(`  ${parent} ||--o{ ${child} : "${full}"`);
      }

      out.push("```", "");
    }
  }
  return out.join("\n").trimEnd();
}

// ---------------------------------------------------------------------------
// splice generated regions into the mdx page
// ---------------------------------------------------------------------------

function splice(page, region, body) {
  const start = `{/* gen:${region}:start */}`;
  const end = `{/* gen:${region}:end */}`;
  const i = page.indexOf(start);
  const j = page.indexOf(end);
  if (i === -1 || j === -1 || j < i) {
    throw new Error(`could not find markers for region "${region}" in ${pagePath}`);
  }
  return page.slice(0, i + start.length) + "\n\n" + body + "\n\n" + page.slice(j);
}

function main() {
  const { schema } = buildSqliteSchema();
  const sqlite = renderSqlite(schema);
  const idb = renderIdb(IDB_DATABASES.map(parseIdb));

  let page = readFileSync(pagePath, "utf8");
  page = splice(page, "sqlite", sqlite);
  page = splice(page, "indexeddb", idb);
  writeFileSync(pagePath, page);

  console.log("updated", pagePath);
}

main();
