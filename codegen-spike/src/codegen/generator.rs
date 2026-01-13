//! TypeScript client generator - outputs route config + schemas

use crate::server::route_def::{self, RouteInfo};
use std::collections::HashSet;
use zod_gen::ZodGenerator;

fn generate_schema_file(routes: &[RouteInfo]) -> Result<String, Box<dyn std::error::Error>> {
    let mut generator = ZodGenerator::new();
    let mut registered = HashSet::new();

    crate::types::register_all_types(&mut generator, &mut registered);

    // Validate all route types are registered
    for route in routes {
        if let Some(t) = extract_type(route.request_type) {
            if !registered.contains(&t) {
                panic!("Type '{}' used in '{}' not registered!", t, route.name);
            }
        }
        if let Some(t) = extract_type(route.response_type) {
            if !registered.contains(&t) {
                panic!("Type '{}' used in '{}' not registered!", t, route.name);
            }
        }
    }

    Ok(generator.generate())
}

fn extract_type(rust_type: &str) -> Option<String> {
    if rust_type == "String" {
        return None;
    }
    if let Some(start) = rust_type.find("Vec<") {
        return extract_type(&rust_type[start + 4..].trim_end_matches('>'));
    }
    if let Some(start) = rust_type.find("Option<") {
        return extract_type(&rust_type[start + 7..].trim_end_matches('>'));
    }
    Some(
        rust_type
            .split("::")
            .last()
            .unwrap_or(rust_type)
            .to_string(),
    )
}

fn generate_routes_file(routes: &[RouteInfo]) -> String {
    let mut output = String::from("// Generated route config\nimport * as s from './schema';\n\n");
    output.push_str("export const routes = {\n");

    for route in routes {
        let req_schema = schema_ref(route.request_type);
        let resp_schema = schema_ref(route.response_type);

        output.push_str(&format!(
            "  {}: {{ method: '{}', path: '{}', req: {}, resp: {} }},\n",
            route.name,
            route.method.as_str(),
            route.path,
            req_schema,
            resp_schema
        ));
    }

    output.push_str("};\n");
    output
}

fn schema_ref(rust_type: &str) -> String {
    if rust_type == "String" {
        return "null".to_string();
    }

    let clean = rust_type.split("::").last().unwrap_or(rust_type);

    if let Some(inner) = clean.strip_prefix("Vec<").and_then(|s| s.strip_suffix('>')) {
        return format!("s.{}Schema.array()", inner);
    }

    format!("s.{}Schema", clean)
}

pub fn generate_all() -> Result<(), Box<dyn std::error::Error>> {
    let routes = route_def::all_routes();
    std::fs::create_dir_all("freqhole-api-client/src/codegen")?;

    let schema = generate_schema_file(&routes)?;
    std::fs::write("freqhole-api-client/src/codegen/schema.ts", schema)?;

    let routes_config = generate_routes_file(&routes);
    std::fs::write("freqhole-api-client/src/codegen/routes.ts", routes_config)?;

    println!("✓ Generated codegen/schema.ts and codegen/routes.ts");
    Ok(())
}
