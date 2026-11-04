// generate the three database diagrams from fresh schemas, never a user's data.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import ts from "typescript";

const site = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(site, "..");
const spume = join(root, "client/spume");
const require = createRequire(join(spume, "package.json"));
require("fake-indexeddb/auto");
const { openDB, unwrap } = require("idb");

function sql(db, query) {
  const result = execFileSync("sqlite3", ["-json", db, query], { encoding: "utf8" }).trim();
  return result ? JSON.parse(result) : [];
}

function files(directory) {
  return readdirSync(directory).filter((name) => /^\d+.*\.sql$/.test(name)).sort()
    .map((name) => readFileSync(join(directory, name), "utf8"));
}

function id(...parts) {
  return parts.join("_").replace(/[^a-zA-Z0-9_]/g, "_");
}

export function viewDependencies(entity, known) {
  const query = entity.sql.replace(/'(?:''|[^'])*'|--[^\n]*|\/\*[\s\S]*?\*\//g, " ");
  return [...new Set(
    [...query.matchAll(/\b(?:FROM|JOIN)\s+["`[]?(\w+)/gi)].map((match) => match[1]),
  )].filter((name) => known.has(name));
}

function viewPipeline(db, database, entity, known) {
  const key = id(database, entity.name);
  const dependencies = viewDependencies(entity, known);
  const baseTables = dependencies.filter((name) => known.get(name).type === "table");
  const upstream = dependencies.filter((name) => known.get(name).type === "view");
  const columns = sql(db, `SELECT name FROM pragma_table_info('${entity.name}')`).map((column) => column.name);
  if (!columns.length) throw new Error(`view ${entity.name} has no output columns`);
  const groups = new Map();
  for (const column of columns) {
    const prefix = column.match(/^(song|album|artist|playlist)_/)?.[1] || "row";
    if (!groups.has(prefix)) groups.set(prefix, []);
    groups.get(prefix).push(column);
  }
  const lines = [
    `subgraph ${key}_pipeline["${entity.name}"]`,
    "direction LR",
    `${key}_input["source tables<br/>${baseTables.join("<br/>") || "(upstream views only)"}"]:::input`,
    `${key}[["${entity.name}<br/>stored SELECT"]]:::view`,
    `${key}_input -->|reads| ${key}`,
  ];
  if (entity.name.endsWith("_query_view")) {
    const prefix = entity.name.replace("_query_view", "");
    const filter = prefix === "playlist_song" ? "playlist_id" : prefix === "video" ? "id" : `${prefix}_id`;
    const order = [prefix === "playlist_song" ? "position" : `${prefix}_name`, `${prefix}_title`, "title", filter]
      .find((column) => columns.includes(column));
    if (!columns.includes(filter) || !order) throw new Error(`no caller example columns for ${entity.name}`);
    lines.push(`${key}_caller["example caller inputs (not view parameters)<br/>WHERE ${filter} = ?<br/>ORDER BY ${order}<br/>LIMIT ? OFFSET ?"]:::caller`);
    lines.push(`${key}_caller -.->|select, filter, sort, page| ${key}`);
  }
  for (const [prefix, fields] of groups) {
    const rows = [];
    for (let i = 0; i < fields.length; i += 2) rows.push(fields.slice(i, i + 2).join(", "));
    lines.push(`${key}_output_${prefix}["${prefix} output · ${fields.length} columns<br/>${rows.join("<br/>")}"]:::output`);
    lines.push(`${key} -->|projects| ${key}_output_${prefix}`);
  }
  lines.push("end");
  for (const dependency of upstream) {
    lines.push(`${id(database, dependency)} -->|upstream view| ${key}`);
  }
  return lines;
}

export function sqliteDiagrams() {
  const directory = mkdtempSync(join(tmpdir(), "freqhole-schema-"));
  const tables = ["erDiagram"];
  const views = [
    "flowchart LR",
    "classDef view fill:#86198f,color:#fff;",
    "classDef input fill:#164e63,color:#fff;",
    "classDef output fill:#14532d,color:#fff;",
    "classDef caller fill:#713f12,color:#fff;",
  ];
  let tableCount = 0;
  let viewCount = 0;
  try {
    for (const [name, migrations] of [
      ["grimoire", "migrations"],
      ["haruspex", "lib/haruspex/rust/migrations"],
      ["reliquary", "lib/reliquary/rust/migrations"],
    ]) {
      const db = join(directory, `${name}.db`);
      execFileSync("sqlite3", ["-bail", db], {
        input: ["PRAGMA trusted_schema=ON;", ...files(join(root, migrations)), ""].join("\n;\n"),
      });
      if (name === "grimoire") {
        for (const { name: view } of sql(db, "SELECT name FROM sqlite_master WHERE type='view'")) {
          execFileSync("sqlite3", ["-bail", db, `DROP VIEW "${view.replace(/"/g, '""')}"`]);
        }
        const source = readFileSync(join(root, "grimoire/src/database.rs"), "utf8");
        const viewFiles = [...source.matchAll(/include_str!\("\.\.\/\.\.\/(migrations\/views\/[^"]+)"\)/g)];
        if (!viewFiles.length) throw new Error("no registered SQLite views found");
        for (const [, path] of viewFiles) {
          execFileSync("sqlite3", ["-bail", db], { input: readFileSync(join(root, path), "utf8") });
        }
      }
      const entities = sql(db, `SELECT name, type, sql FROM sqlite_master
        WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'
        AND name NOT LIKE '%\\_fts%' ESCAPE '\\' ORDER BY name`);
      const known = new Map(entities.map((entity) => [entity.name, entity]));
      for (const entity of entities) {
        const key = id(name, entity.name);
        if (entity.type === "view") {
          viewCount++;
          views.push(...viewPipeline(db, name, entity, known));
          continue;
        }
        tableCount++;
        const foreignKeys = sql(db, `SELECT * FROM pragma_foreign_key_list('${entity.name}')`);
        tables.push(`  ${key}["${name}.${entity.name}"] {`);
        for (const column of sql(db, `SELECT * FROM pragma_table_info('${entity.name}')`)) {
          const keys = [column.pk ? "PK" : "", foreignKeys.some((fk) => fk.from === column.name) ? "FK" : ""]
            .filter(Boolean).join(",");
          tables.push(`    ${(column.type || "ANY").replace(/\W/g, "_")} ${column.name}${keys ? ` ${keys}` : ""}`);
        }
        tables.push("  }");
        for (const fk of foreignKeys) {
          if (known.get(fk.table)?.type === "table") {
            tables.push(`  ${id(name, fk.table)} ||--o{ ${key} : "${fk.from}"`);
          }
        }
      }
    }
    return { sqlite: tables.join("\n"), views: views.join("\n"), tableCount, viewCount };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function source(path) {
  return ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
}

function constants(paths) {
  const values = {};
  for (const path of paths) {
    for (const statement of source(path).statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
        const initializer = declaration.initializer;
        if (ts.isStringLiteral(initializer)) values[declaration.name.text] = initializer.text;
        if (ts.isNumericLiteral(initializer)) values[declaration.name.text] = Number(initializer.text);
      }
    }
  }
  return values;
}

async function openClientDb(path, typePath, nameKey, versionKey) {
  const ast = source(path);
  let upgrade;
  function visit(node) {
    if (ts.isMethodDeclaration(node) && node.name.getText(ast) === "upgrade") upgrade = node;
    ts.forEachChild(node, visit);
  }
  visit(ast);
  if (!upgrade) throw new Error(`no upgrade method in ${path}`);
  const values = constants(typePath ? [path, typePath] : [path]);
  // execute the real fresh-install upgrade, including index changes. regex-only
  // parsing misses stores/indexes created in loops and later migrations.
  const compiled = ts.transpileModule(`const upgrade = ${upgrade.modifiers?.some(
    (modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword,
  ) ? "async " : ""}function(${upgrade.parameters.map((p) => p.getText(ast)).join(",")}) ${upgrade.body.getText(ast)}`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const upgradeFn = new Function(...Object.keys(values), `${compiled}; return upgrade;`)(...Object.values(values));
  let upgraded;
  const db = await openDB(values[nameKey], values[versionKey], {
    upgrade(...args) { upgraded = upgradeFn(...args); },
  });
  await upgraded;
  return unwrap(db);
}

export async function indexedDbDiagram() {
  const dbs = [];
  try {
    dbs.push(await openClientDb(
      join(spume, "src/app/services/storage/db.ts"),
      join(spume, "src/app/services/storage/types.ts"), "APP_DB_NAME", "APP_DB_VERSION",
    ));
    dbs.push(await openClientDb(
      join(spume, "src/music/services/storage/db/init.ts"),
      join(spume, "src/music/services/storage/types.ts"), "MUSIC_DB_NAME", "MUSIC_DB_VERSION",
    ));
    dbs.push(await openClientDb(
      join(spume, "src/video/services/storage/db/init.ts"), null, "VIDEO_DB_NAME", "VIDEO_DB_VERSION",
    ));
    const blobSource = source(join(root, "lib/reliquary/ts/src/blobs/db.ts"));
    const statements = blobSource.statements.filter((statement) =>
      ts.isVariableStatement(statement) && statement.declarationList.declarations.some(
        (declaration) => ["STORE_NAME", "REFS_STORE_NAME", "DB_VERSION", "BLOB_INDEXES", "REFS_INDEXES"]
          .includes(declaration.name.getText(blobSource)),
      ) || ts.isFunctionDeclaration(statement) && statement.name?.text === "openVersioned",
    );
    const blobCode = ts.transpileModule(
      statements.map((statement) => statement.getText(blobSource)).join("\n"),
      { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
    ).outputText;
    const openBlobs = new Function(`${blobCode}; return () => openVersioned("freqhole_blobs", DB_VERSION);`)();
    dbs.push(await openBlobs());
    const lines = ["erDiagram"];
    const stores = new Map();
    let storeCount = 0;
    for (const db of dbs) {
      const names = [...db.objectStoreNames];
      const tx = db.transaction(names);
      for (const name of names) {
        storeCount++;
        const store = tx.objectStore(name);
        const fields = new Set([store.keyPath].flat().filter(Boolean));
        for (const indexName of store.indexNames) {
          for (const field of [store.index(indexName).keyPath].flat()) fields.add(field);
        }
        stores.set(id(db.name, name), fields);
        lines.push(`  ${id(db.name, name)}["${db.name}.${name} (v${db.version})"] {`);
        const key = store.keyPath ? JSON.stringify(store.keyPath).replace(/"/g, "") : "out_of_line";
        lines.push(`    key ${id(key)} PK "${key}${store.autoIncrement ? ", auto" : ""}"`);
        for (const indexName of store.indexNames) {
          const index = store.index(indexName);
          const path = JSON.stringify(index.keyPath).replace(/"/g, "");
          lines.push(`    index ${id(indexName)}${index.unique ? " UK" : ""} "${path}${index.multiEntry ? ", multiEntry" : ""}"`);
        }
        lines.push("  }");
      }
    }
    // logical references verified against record types and lookup code, not
    // inferred foreign keys. validate both indexed/key fields on every run.
    // music: storage/types.ts, storage/playlists.ts, db/importReview.ts.
    // video: storage/db/{init,seasons,videos,entityTags}.ts.
    // app: storage/db.ts; blobs: lib/reliquary/ts/src/blobs/db.ts.
    const references = [
      ["freqhole_music", "albums", "artist_id", "freqhole_music", "artists", "artist_id"],
      ["freqhole_music", "albums", "genre_id", "freqhole_music", "genres", "genre_id"],
      ["freqhole_music", "songs", "artist_id", "freqhole_music", "artists", "artist_id"],
      ["freqhole_music", "songs", "album_id", "freqhole_music", "albums", "album_id"],
      ["freqhole_music", "album_tags", "album_id", "freqhole_music", "albums", "album_id"],
      ["freqhole_music", "album_tags", "tag_id", "freqhole_music", "tags", "tag_id"],
      ["freqhole_music", "album_taxons", "album_id", "freqhole_music", "albums", "album_id"],
      ["freqhole_music", "album_taxons", "taxon_id", "freqhole_music", "taxons", "taxon_id"],
      ["freqhole_music", "entity_taxons", "taxon_id", "freqhole_music", "taxons", "taxon_id"],
      ["freqhole_music", "playlist_items", "playlist_id", "freqhole_music", "playlists", "playlist_id"],
      ["freqhole_music", "playlist_items", "entity_id", "freqhole_music", "songs", "sha256", "entity_type=song; sha256, not id"],
      ["freqhole_music", "playlist_items", "entity_id", "freqhole-video", "videos", "id", "entity_type=video"],
      ["freqhole_music", "import_review_blobz", "song_id", "freqhole_music", "songs", "id"],
      ["freqhole_music", "import_review_blobz", "session_id", "freqhole_music", "import_review_sessionz", "session_id"],
      ["freqhole-video", "video_seasons", "series_id", "freqhole-video", "video_series", "id"],
      ["freqhole-video", "videos", "series_id", "freqhole-video", "video_series", "id"],
      ["freqhole-video", "videos", "season_id", "freqhole-video", "video_seasons", "id"],
      ["freqhole-video", "entity_tags", "tag_id", "freqhole-video", "tags", "tag_id"],
      ["freqhole-video", "entity_tags", "entity_id", "freqhole-video", "videos", "id", "entity_type=video"],
      ["freqhole-video", "entity_tags", "entity_id", "freqhole-video", "video_series", "id", "entity_type=video_series"],
      ["freqhole-video", "entity_tags", "entity_id", "freqhole-video", "video_seasons", "id", "entity_type=video_season"],
      ["freqhole_app", "user_peer_nodes", "user_id", "freqhole_app", "users", "id"],
      ["freqhole_blobs", "blobs", "parent_blob_id", "freqhole_blobs", "blobs", "blob_id"],
      ["freqhole_blobs", "blob_canvas_refs", "blob_id", "freqhole_blobs", "blobs", "blob_id"],
    ];
    for (const store of ["favorites", "ratings"]) {
      for (const [type, db, target, key] of [
        ["song", "freqhole_music", "songs", "id"],
        ["album", "freqhole_music", "albums", "album_id"],
        ["artist", "freqhole_music", "artists", "artist_id"],
        ["video", "freqhole-video", "videos", "id"],
        ...(store === "favorites" ? [
          ["playlist", "freqhole_music", "playlists", "playlist_id"],
          ["video_series", "freqhole-video", "video_series", "id"],
        ] : []),
      ]) {
        references.push(["freqhole_music", store, "target_id", db, target, key, `target_type=${type}`]);
      }
    }
    for (const [db, child, field, targetDb, parent, targetField, condition] of references) {
      const childId = id(db, child);
      const parentId = id(targetDb, parent);
      if (!stores.get(childId)?.has(field) || !stores.get(parentId)?.has(targetField)) {
        throw new Error(`stale IndexedDB reference: ${db}.${child}.${field} -> ${targetDb}.${parent}.${targetField}`);
      }
      const label = `${field} -> ${targetField}${condition ? `; ${condition}` : ""}`;
      lines.push(`  ${parentId} }o..o{ ${childId} : "${label}"`);
    }
    return { indexeddb: lines.join("\n"), storeCount, referenceCount: references.length };
  } finally {
    for (const db of dbs) db.close();
  }
}

if (resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  const diagrams = { ...sqliteDiagrams(), ...await indexedDbDiagram() };
  mkdirSync(join(site, "src/data"), { recursive: true });
  writeFileSync(join(site, "src/data/database-schema.json"), JSON.stringify(diagrams, null, 2) + "\n");
  console.log(`generated 3 diagrams: ${diagrams.tableCount} tables, ${diagrams.viewCount} views, ${diagrams.storeCount} IndexedDB stores, ${diagrams.referenceCount} logical references`);
}
