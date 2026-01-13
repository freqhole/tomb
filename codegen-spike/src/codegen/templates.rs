//! TypeScript code templates
//! All r# format! strings for generating TypeScript code

use crate::server::route_def::RouteDefinition;

// =============================================================================
// Type Name Extraction
// =============================================================================

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

// =============================================================================
// schema.ts Templates
// =============================================================================

/// Generate schema file header
pub fn schema_header() -> String {
    r#"// Auto-generated types and Zod schemas
// DO NOT EDIT

"#
    .to_string()
}

// =============================================================================
// api-client.ts Templates
// =============================================================================

/// Generate API client header with imports and config
pub fn api_client_header() -> String {
    r#"// Auto-generated API client
// DO NOT EDIT

import * as schema from './schema';

// ============================================================================
// Configuration
// ============================================================================

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

/// Generate a single client function
/// This is now a single big r# template for readability
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

    // Determine if we need validation
    let needs_validation = has_body && req_type != "String";

    // Build the schema references
    let req_schema = if req_type.ends_with("[]") {
        format!("schema.{}Schema", req_type.trim_end_matches("[]"))
    } else {
        format!("schema.{}Schema", req_type)
    };

    let resp_schema = if resp_type.ends_with("[]") {
        format!("schema.{}Schema", resp_type.trim_end_matches("[]"))
    } else {
        format!("schema.{}Schema", resp_type)
    };

    // Build type references for function signature
    let req_type_ref = if req_type == "String" {
        "string".to_string()
    } else {
        format!("schema.{}", req_type)
    };

    let resp_type_ref = format!("schema.{}", resp_type);

    // Build response parsing code
    let resp_parse = if resp_type.ends_with("[]") {
        format!("return {}.array().parse(data);", resp_schema)
    } else {
        format!("return {}.parse(data);", resp_schema)
    };

    // Now build the entire function as one big template
    if needs_validation {
        // Function with validation
        format!(
            r#"export async function {name}(params: {req_type}): Promise<{resp_type}> {{
  const validated = {req_schema}.parse(params);

  const response = await fetch(`${{getBaseUrl()}}{path}`, {{
    method: '{method}',
    headers: {{
      'Content-Type': 'application/json',
    }},
    body: JSON.stringify(validated),
  }});

  if (!response.ok) {{
    throw new Error(`API error: ${{response.status}}`);
  }}

  const data = await response.json();
  {resp_parse}
}}
"#,
            name = route.name,
            req_type = req_type_ref,
            resp_type = resp_type_ref,
            req_schema = req_schema,
            path = route.path,
            method = method,
            resp_parse = resp_parse,
        )
    } else {
        // Function without validation (no body or String params)
        format!(
            r#"export async function {name}(params: {req_type}): Promise<{resp_type}> {{
  const response = await fetch(`${{getBaseUrl()}}{path}`, {{
    method: '{method}',
    headers: {{
      'Content-Type': 'application/json',
    }},
  }});

  if (!response.ok) {{
    throw new Error(`API error: ${{response.status}}`);
  }}

  const data = await response.json();
  {resp_parse}
}}
"#,
            name = route.name,
            req_type = req_type_ref,
            resp_type = resp_type_ref,
            path = route.path,
            method = method,
            resp_parse = resp_parse,
        )
    }
}
