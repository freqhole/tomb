//! typescript client generator - outputs route config + schemas

use grimoire::api_registry::{RouteAuth, RouteInfo};
use grimoire::offal;
use std::collections::HashSet;
use zod_gen::ZodGenerator;

fn generate_schema_file(routes: &[RouteInfo]) -> Result<String, Box<dyn std::error::Error>> {
    let mut generator = ZodGenerator::new();
    let mut registered = HashSet::new();

    grimoire::api_registry::type_registry::register_all_types(&mut generator, &mut registered);

    // validate all route types are registered (collect all errors first)
    let mut missing_types = Vec::new();
    for route in routes {
        if let Some(t) = extract_type(route.request_type) {
            if !registered.contains(&t) {
                missing_types.push(format!("  {} (request for '{}')", t, route.name));
            }
        }
        if let Some(t) = extract_type(route.response_type) {
            if !registered.contains(&t) {
                missing_types.push(format!("  {} (response for '{}')", t, route.name));
            }
        }
    }

    if !missing_types.is_empty() {
        missing_types.sort();
        missing_types.dedup();
        panic!(
            "Unregistered types used in routes:\n{}",
            missing_types.join("\n")
        );
    }

    Ok(generator.generate())
}

fn extract_type(rust_type: &str) -> Option<String> {
    // primitives, json types, and empty types don't need registration
    if rust_type == "String"
        || rust_type == "bool"
        || rust_type == "i32"
        || rust_type == "i64"
        || rust_type == "u32"
        || rust_type == "u64"
        || rust_type == "f32"
        || rust_type == "f64"
        || rust_type == "serde_json::Value"
        || rust_type == "EmptyRequest"
        || rust_type == "EmptyResponse"
        || rust_type == "()"
    {
        return None;
    }
    if let Some(start) = rust_type.find("Vec<") {
        return extract_type(rust_type[start + 4..].trim_end_matches('>'));
    }
    if let Some(start) = rust_type.find("Option<") {
        return extract_type(rust_type[start + 7..].trim_end_matches('>'));
    }
    Some(
        rust_type
            .split("::")
            .last()
            .unwrap_or(rust_type)
            .to_string(),
    )
}

/// format RouteAuth enum as TypeScript object literal
fn auth_to_ts(auth: &RouteAuth) -> String {
    match auth {
        RouteAuth::Public => "{ type: 'public' }".to_string(),
        RouteAuth::Authenticated => "{ type: 'authenticated' }".to_string(),
        RouteAuth::Role(role) => {
            format!("{{ type: 'role', role: '{}' }}", role.as_str())
        }
        RouteAuth::Owner => "{ type: 'owner' }".to_string(),
        RouteAuth::OwnerOr(role) => {
            format!("{{ type: 'owner_or', role: '{}' }}", role.as_str())
        }
    }
}

fn generate_routes_file(routes: &[RouteInfo]) -> String {
    let mut output = String::from(
        "// generated route config\nimport * as s from './schema';\nimport { z } from 'zod';\n\n",
    );

    // add role hierarchy constant
    output.push_str("// role hierarchy - lower number = higher privilege\n");
    output.push_str("export const roleHierarchy = {\n");
    output.push_str("  root: 0,\n");
    output.push_str("  admin: 10,\n");
    output.push_str("  member: 20,\n");
    output.push_str("  viewer: 30,\n");
    output.push_str("} as const;\n\n");

    // add type definitions
    output.push_str("export type UserRoleName = keyof typeof roleHierarchy;\n");
    output.push_str(
        "export type RouteAuthType = 'public' | 'authenticated' | 'role' | 'owner' | 'owner_or';\n",
    );
    output.push_str("export type RouteAuth =\n");
    output.push_str("  | { type: 'public' }\n");
    output.push_str("  | { type: 'authenticated' }\n");
    output.push_str("  | { type: 'role'; role: UserRoleName }\n");
    output.push_str("  | { type: 'owner' }\n");
    output.push_str("  | { type: 'owner_or'; role: UserRoleName };\n\n");

    // group routes by domain (BTreeMap for consistent ordering)
    let mut domains: std::collections::BTreeMap<&str, Vec<&RouteInfo>> =
        std::collections::BTreeMap::new();
    for route in routes {
        domains
            .entry(route.domain.as_str())
            .or_default()
            .push(route);
    }

    output.push_str("export const routes = {\n");

    for (domain, mut domain_routes) in domains {
        // sort routes by name within each domain
        domain_routes.sort_by_key(|r| r.name);

        output.push_str(&format!("  {}: {{\n", domain));

        for route in domain_routes {
            let req_schema = schema_ref(route.request_type);
            let resp_schema = schema_ref(route.response_type);
            let auth_ts = auth_to_ts(&route.auth);

            output.push_str(&format!(
                "    {}: {{ method: '{}', path: '{}', req: {}, resp: {}, auth: {} as const }},\n",
                route.name,
                route.method.as_str(),
                route.path,
                req_schema,
                resp_schema,
                auth_ts
            ));
        }

        output.push_str("  },\n");
    }

    output.push_str("} as const;\n");
    output
}

fn schema_ref(rust_type: &str) -> String {
    if rust_type == "String" {
        return "null".to_string();
    }

    // handle primitives and json types
    match rust_type {
        "bool" => return "z.boolean()".to_string(),
        "i32" | "i64" | "u32" | "u64" | "f32" | "f64" => return "z.number()".to_string(),
        "serde_json::Value" => return "z.any()".to_string(),
        _ => {}
    }

    let clean = rust_type.split("::").last().unwrap_or(rust_type);

    if let Some(inner) = clean.strip_prefix("Vec<").and_then(|s| s.strip_suffix('>')) {
        // special case: Vec<String> should be z.string().array()
        if inner == "String" {
            return "z.string().array()".to_string();
        }
        return format!("s.{}Schema.array()", inner);
    }

    format!("s.{}Schema", clean)
}

pub fn generate_all() -> Result<(), Box<dyn std::error::Error>> {
    let routes = offal::all_routes();
    std::fs::create_dir_all("freqhole-api-client/src/codegen")?;

    let schema = generate_schema_file(&routes)?;
    // zod_gen 1.x emits `Option<T>` as `.nullable()`, which rejects undefined/
    // missing keys. Rust `Option::None` round-tripping through
    // serde_wasm_bindgen / JSON can surface as undefined on the JS side, so
    // relax to `.nullish()` (null OR undefined). `.nullish()` is a strict
    // superset of `.nullable()` — always safe to substitute.
    let schema = schema.replace(".nullable()", ".nullish()");
    // zod_gen 1.x emits `z.discriminatedUnion('disc', [z.intersection(...)])`
    // for tagged enums whose variants carry inlined struct payloads. zod v4's
    // `discriminatedUnion` rejects `ZodIntersection` members (the discriminator
    // can't be statically extracted through an intersection wrapper). fall
    // back to `z.union(...)`: same accepted inputs, just no discriminator
    // optimization. drops the leading `'disc',` argument.
    let schema = regex_replace_disc_union(&schema);
    // zod_gen 1.x doesn't propagate `#[serde(rename_all = "...")]` onto
    // the tag literals of internally-tagged enums. fix up the schemas
    // where we actually rely on this at runtime — job_events broker
    // over iroh/ipc emits snake_case kinds, entity refs, and statuses.
    let schema = rewrite_kind_literals_to_snake_case(&schema, "JobEventSchema");
    let schema = rewrite_kind_literals_to_snake_case(&schema, "CloseReasonSchema");
    let schema = rewrite_kind_literals_to_snake_case(&schema, "EntityRefSchema");
    let schema = rewrite_kind_literals_to_snake_case(&schema, "EventFilterSchema");
    let schema = rewrite_kind_literals_to_snake_case(&schema, "JobStateSnapshotSchema");
    // job status wire enum is `#[serde(rename_all = "snake_case")]` but
    // emitted as PascalCase literals (`Pending` / `Running` / ...). every
    // schema that references the status field carries inline copies of
    // these literals, so rewrite each one.
    let schema = rewrite_status_literals_to_snake_case(&schema, "JobStatusWireSchema");
    let schema = rewrite_status_literals_to_snake_case(&schema, "JobStateSnapshotSchema");
    let schema = rewrite_status_literals_to_snake_case(&schema, "JobEventSchema");
    std::fs::write("freqhole-api-client/src/codegen/schema.ts", schema)?;

    let routes_config = generate_routes_file(&routes);
    std::fs::write("freqhole-api-client/src/codegen/routes.ts", routes_config)?;

    let admin_commands = generate_admin_commands_file();
    std::fs::write(
        "freqhole-api-client/src/codegen/admin_commands.ts",
        admin_commands,
    )?;

    println!("generated codegen/schema.ts, codegen/routes.ts, and codegen/admin_commands.ts");
    Ok(())
}

/// emit the freqhole-admin/1 ALPN command map.
///
/// each entry exposes:
/// - `req`: zod schema for the request payload (or `z.void()` for empty)
/// - `resp`: zod schema for the response data
/// - `auth`: required role on the remote
fn generate_admin_commands_file() -> String {
    use grimoire::admin_dispatch::registry::{all_commands, AdminCommandInfo};

    let mut output = String::from(
        "// generated freqhole-admin/1 ALPN command map\n\
         //\n\
         // do not edit by hand: regenerate with `cd client-codegen && make all`.\n\
         import * as s from './schema';\n\
         import { z } from 'zod';\n\n\
         export type AdminAuthType = 'admin';\n\n\
         export type AdminAuth = { type: AdminAuthType };\n\n",
    );

    output.push_str("export const adminCommands = {\n");

    let mut commands: Vec<&AdminCommandInfo> = all_commands().iter().collect();
    commands.sort_by_key(|c| c.name);

    for cmd in commands {
        let req = admin_schema_ref(cmd.request_type);
        let resp = admin_schema_ref(cmd.response_type);
        output.push_str(&format!(
            "  {}: {{ req: {}, resp: {}, auth: {{ type: '{}' }} as const }},\n",
            cmd.name,
            req,
            resp,
            cmd.auth.as_str(),
        ));
    }

    output.push_str("} as const;\n\n");
    output.push_str("export type AdminCommandName = keyof typeof adminCommands;\n");
    output
}

/// schema reference for an admin command type. mirrors `schema_ref` for
/// HTTP routes but with admin-specific empty/void handling.
fn admin_schema_ref(rust_type: &str) -> String {
    match rust_type {
        "EmptyRequest" | "()" => return "z.void().optional()".to_string(),
        "EmptyResponse" => return "z.unknown().optional()".to_string(),
        "serde_json::Value" => return "z.any()".to_string(),
        "bool" => return "z.boolean()".to_string(),
        "i32" | "i64" | "u32" | "u64" | "f32" | "f64" => return "z.number()".to_string(),
        "String" => return "z.string()".to_string(),
        _ => {}
    }

    let clean = rust_type.split("::").last().unwrap_or(rust_type);

    if let Some(inner) = clean.strip_prefix("Vec<").and_then(|s| s.strip_suffix('>')) {
        if inner == "String" {
            return "z.string().array()".to_string();
        }
        return format!("s.{}Schema.array()", inner);
    }

    format!("s.{}Schema", clean)
}

/// within the named schema's definition block, lowercase + snake_case
/// every `kind: z.literal('Foo')` so it matches the actual wire format
/// emitted by rust serde with `#[serde(tag = "kind", rename_all =
/// "snake_case")]`. zod_gen 1.x doesn't honor `rename_all` on the
/// discriminator, so we fix it here.
fn rewrite_kind_literals_to_snake_case(input: &str, schema_name: &str) -> String {
    let needle = format!("export const {schema_name} = ");
    let Some(start) = input.find(&needle) else {
        return input.to_string();
    };
    // body ends at the next blank line followed by `export ` (or eof).
    // simpler: scan for the matching trailing `;` at brace depth 0.
    let body_start = start + needle.len();
    let mut depth: i32 = 0;
    let mut end = input.len();
    for (i, ch) in input[body_start..].char_indices() {
        match ch {
            '(' | '[' | '{' => depth += 1,
            ')' | ']' | '}' => depth -= 1,
            ';' if depth == 0 => {
                end = body_start + i + 1;
                break;
            }
            _ => {}
        }
    }
    let mut out = String::with_capacity(input.len());
    out.push_str(&input[..body_start]);
    let body = &input[body_start..end];
    let mut rest = body;
    let lit = "kind: z.literal('";
    while let Some(idx) = rest.find(lit) {
        out.push_str(&rest[..idx]);
        out.push_str(lit);
        let after = &rest[idx + lit.len()..];
        if let Some(close) = after.find('\'') {
            let camel = &after[..close];
            out.push_str(&pascal_to_snake(camel));
            out.push('\'');
            rest = &after[close + 1..];
        } else {
            rest = after;
        }
    }
    out.push_str(rest);
    out.push_str(&input[end..]);
    out
}

fn pascal_to_snake(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 4);
    for (i, ch) in s.char_indices() {
        if ch.is_uppercase() {
            if i > 0 {
                out.push('_');
            }
            for lc in ch.to_lowercase() {
                out.push(lc);
            }
        } else {
            out.push(ch);
        }
    }
    out
}

/// within the named schema's definition block, rewrite the five
/// `JobStatusWire` literals (`'Pending'` / `'Running'` / `'Completed'`
/// / `'Failed'` / `'Cancelled'`) to their snake_case wire form. same
/// motivation as `rewrite_kind_literals_to_snake_case`: zod_gen 1.x
/// doesn't propagate `rename_all = "snake_case"` onto enum variant
/// literals. unlike `kind`, the status field has a non-uniform
/// variable name (sometimes `status`, sometimes `from` / `to`), so
/// we match by literal value rather than by surrounding key.
fn rewrite_status_literals_to_snake_case(input: &str, schema_name: &str) -> String {
    const STATUS_LITERALS: [&str; 5] = ["Pending", "Running", "Completed", "Failed", "Cancelled"];
    let needle = format!("export const {schema_name} = ");
    let Some(start) = input.find(&needle) else {
        return input.to_string();
    };
    let body_start = start + needle.len();
    let mut depth: i32 = 0;
    let mut end = input.len();
    for (i, ch) in input[body_start..].char_indices() {
        match ch {
            '(' | '[' | '{' => depth += 1,
            ')' | ']' | '}' => depth -= 1,
            ';' if depth == 0 => {
                end = body_start + i + 1;
                break;
            }
            _ => {}
        }
    }
    let mut body = input[body_start..end].to_string();
    for lit in STATUS_LITERALS {
        let pat = format!("z.literal('{lit}')");
        let rep = format!("z.literal('{}')", pascal_to_snake(lit));
        body = body.replace(&pat, &rep);
    }
    let mut out = String::with_capacity(input.len());
    out.push_str(&input[..body_start]);
    out.push_str(&body);
    out.push_str(&input[end..]);
    out
}

/// rewrite every `z.discriminatedUnion('disc', [` occurrence to `z.union([`.
/// zod v4 rejects `ZodIntersection` inside `discriminatedUnion`, and zod_gen
/// emits intersections for tagged enums whose variants carry inlined struct
/// payloads. union accepts the same inputs (just no discriminator fast-path).
fn regex_replace_disc_union(input: &str) -> String {
    let needle = "z.discriminatedUnion(";
    let mut out = String::with_capacity(input.len());
    let mut rest = input;
    while let Some(idx) = rest.find(needle) {
        out.push_str(&rest[..idx]);
        let after = &rest[idx + needle.len()..];
        if let Some(bracket) = after.find(", [") {
            out.push_str("z.union([");
            rest = &after[bracket + ", [".len()..];
        } else {
            out.push_str(needle);
            rest = after;
        }
    }
    out.push_str(rest);
    out
}
