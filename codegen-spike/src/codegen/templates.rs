//! TypeScript code templates
//! All r# format! strings for generating TypeScript code

use crate::server::route_def::RouteDefinition;

/// Extract clean TypeScript type name from Rust's fully-qualified type name
/// e.g., "codegen_spike::types::music::QueryParams" -> "QueryParams"
///      "alloc::vec::Vec<codegen_spike::types::music::Song>" -> "Song[]"
pub fn extract_type_name(rust_type: &str) -> String {
    // Handle Vec<T> -> T[]
    if let Some(inner) = rust_type.strip_prefix("alloc::vec::Vec<") {
        let inner = inner.strip_suffix('>').unwrap_or(inner);
        return format!("{}[]", extract_type_name(inner));
    }

    // Handle Option<T> -> T | null
    if let Some(inner) = rust_type.strip_prefix("core::option::Option<") {
        let inner = inner.strip_suffix('>').unwrap_or(inner);
        return format!("{} | null", extract_type_name(inner));
    }

    // Extract just the type name from full path
    rust_type
        .split("::")
        .last()
        .unwrap_or(rust_type)
        .to_string()
}

/// Generate a single client function
pub fn client_function(route: &RouteDefinition) -> String {
    let method = route.method.as_str();
    let has_body = matches!(
        route.method,
        crate::server::route_def::Method::POST
            | crate::server::route_def::Method::PUT
            | crate::server::route_def::Method::PATCH
    );

    let req_type = extract_type_name(route.request_type);
    let resp_type = extract_type_name(route.response_type);

    let req_schema = if req_type.ends_with("[]") {
        format!("{}Schema", req_type.trim_end_matches("[]"))
    } else if req_type == "String" {
        String::new()
    } else {
        format!("{}Schema", req_type)
    };

    let resp_schema = if resp_type.ends_with("[]") {
        format!("{}Schema", resp_type.trim_end_matches("[]"))
    } else {
        format!("{}Schema", resp_type)
    };

    let body_section = if has_body && req_type != "String" {
        "      body: JSON.stringify(validated),\n"
    } else {
        ""
    };

    let validation_section = if has_body && !req_schema.is_empty() {
        format!("  const validated = {}.parse(params);\n\n", req_schema)
    } else {
        String::new()
    };

    let resp_parse = if resp_type.ends_with("[]") {
        format!("  return {}.array().parse(data);", resp_schema)
    } else {
        format!("  return {}.parse(data);", resp_schema)
    };

    format!(
        r#"export async function {name}(params: {req_type}): Promise<{resp_type}> {{
{validation}  const response = await fetch(`${{getBaseUrl()}}{path}`, {{
    method: '{method}',
    headers: {{
      'Content-Type': 'application/json',
    }},
{body}  }});

  if (!response.ok) {{
    throw new Error(`API error: ${{response.status}}`);
  }}

  const data = await response.json();
{resp_parse}
}}
"#,
        name = route.name,
        req_type = req_type,
        resp_type = resp_type,
        path = route.path,
        method = method,
        validation = validation_section,
        body = body_section,
        resp_parse = resp_parse,
    )
}

/// Generate module header with imports
pub fn module_header(module_name: &str, parent_path: &str) -> String {
    let type_import_depth = if parent_path.is_empty() {
        "../.."
    } else {
        "../../.."
    };

    format!(
        r#"// Auto-generated client for {module}
// DO NOT EDIT

import {{ z }} from 'zod';
import {{ getBaseUrl }} from '{depth}/config';
import * as types from '{depth}/types';

"#,
        module = module_name,
        depth = type_import_depth
    )
}

/// Generate config.ts
pub fn config() -> String {
    r#"// Client configuration

let baseUrl = 'http://localhost:3000';

export function getBaseUrl(): string {
  return baseUrl;
}

export function setBaseUrl(url: string) {
  baseUrl = url;
}
"#
    .to_string()
}

/// Generate namespace index that re-exports modules
pub fn namespace_index(modules: &[&str], with_types: bool) -> String {
    let mut output = String::from("// Auto-generated index\n// DO NOT EDIT\n\n");

    if with_types {
        output.push_str("export * as types from './types';\n");
        output.push_str("export { getBaseUrl, setBaseUrl } from './config';\n\n");
    }

    for module in modules {
        output.push_str(&format!("export * as {} from './{}';\n", module, module));
    }

    output
}

/// Generate root index.ts
pub fn root_index() -> String {
    r#"// Auto-generated API client
// DO NOT EDIT

export * as types from './types';
export { getBaseUrl, setBaseUrl } from './config';
export * as api from './api';

// Convenience: also export the api directly as default
import * as api from './api';
export default api;
"#
    .to_string()
}

/// Generate tsconfig.json
pub fn tsconfig() -> String {
    r#"{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "lib": ["ES2020", "DOM"],
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
"#
    .to_string()
}

/// Generate types header
pub fn types_header() -> String {
    r#"// Auto-generated types and Zod schemas
// DO NOT EDIT

import { z } from 'zod';

"#
    .to_string()
}
