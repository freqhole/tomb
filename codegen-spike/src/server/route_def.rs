//! Route definition infrastructure
//! Core types and macros for defining API routes

/// HTTP method
#[derive(Debug, Clone, Copy)]
pub enum Method {
    GET,
    POST,
    PUT,
    DELETE,
    PATCH,
}

impl Method {
    pub fn as_str(&self) -> &'static str {
        match self {
            Method::GET => "GET",
            Method::POST => "POST",
            Method::PUT => "PUT",
            Method::DELETE => "DELETE",
            Method::PATCH => "PATCH",
        }
    }
}

/// Route definition
#[derive(Debug, Clone)]
pub struct RouteDefinition {
    pub key: &'static str,
    pub name: &'static str,
    pub path: &'static str,
    pub method: Method,
    pub request_type: &'static str,
    pub response_type: &'static str,
    pub module_path: &'static str,
}

/// Macro to create a route entry (key, value) tuple
/// Returns (&'static str, RouteDefinition) for easy HashMap insertion
#[macro_export]
macro_rules! route {
    ($key:expr, $name:expr, $path:expr, $method:expr, $module:expr, $req:ty, $resp:ty) => {
        (
            $key,
            $crate::server::route_def::RouteDefinition {
                key: $key,
                name: $name,
                path: $path,
                method: $method,
                request_type: std::any::type_name::<$req>(),
                response_type: std::any::type_name::<$resp>(),
                module_path: $module,
            },
        )
    };
}

/// Helper macro to build HashMap from route entries
#[macro_export]
macro_rules! routes {
    ($($entry:expr),* $(,)?) => {{
        let mut map = HashMap::new();
        $(
            let (key, route) = $entry;
            map.insert(key, route);
        )*
        map
    }};
}
