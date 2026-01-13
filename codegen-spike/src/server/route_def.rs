use inventory;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Domain {
    App,
    Music,
}

impl Domain {
    pub fn as_str(&self) -> &'static str {
        match self {
            Domain::App => "app",
            Domain::Music => "music",
        }
    }
}

#[derive(Debug, Clone)]
pub struct RouteInfo {
    pub name: &'static str,
    pub path: &'static str,
    pub method: Method,
    pub domain: Domain,
    pub request_type: &'static str,
    pub response_type: &'static str,
}

inventory::collect!(RouteInfo);

pub fn all_routes() -> Vec<RouteInfo> {
    inventory::iter::<RouteInfo>
        .into_iter()
        .map(|r| r.clone())
        .collect()
}

pub fn all_routes_map() -> std::collections::HashMap<&'static str, RouteInfo> {
    inventory::iter::<RouteInfo>
        .into_iter()
        .map(|r| (r.name, r.clone()))
        .collect()
}
