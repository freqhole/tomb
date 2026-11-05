// keeps permissions/app-commands.toml in sync with `generate_handler![...]`
// in lib.rs - a command missing from the acl silently fails to invoke from
// the dev wizard (a "remote" origin), see the toml file's header comment.
use std::collections::BTreeSet;

fn registered_commands() -> BTreeSet<String> {
    let src = include_str!("lib.rs");
    let mut out = BTreeSet::new();
    let mut rest = src;
    while let Some(start) = rest.find("generate_handler![") {
        let after = &rest[start + "generate_handler![".len()..];
        let end = after.find(']').expect("unterminated generate_handler!");
        for line in after[..end].lines() {
            let line = line.split("//").next().unwrap_or("").trim();
            for item in line.split(',') {
                let item = item.trim();
                if !item.is_empty() {
                    out.insert(item.rsplit("::").next().unwrap().to_string());
                }
            }
        }
        rest = &after[end..];
    }
    out
}

fn acl_commands() -> BTreeSet<String> {
    let toml: toml::Value = include_str!("../permissions/app-commands.toml")
        .parse()
        .expect("app-commands.toml parses");
    toml["permission"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|p| p.get("commands")?.get("allow")?.as_array())
        .flatten()
        .filter_map(|v| v.as_str().map(str::to_string))
        .collect()
}

#[test]
fn every_registered_command_is_in_the_acl() {
    let registered = registered_commands();
    assert!(
        registered.len() > 50,
        "parsed too few commands: {registered:?}"
    );
    let acl = acl_commands();
    let missing: Vec<_> = registered.difference(&acl).collect();
    assert!(
        missing.is_empty(),
        "add these to permissions/app-commands.toml: {missing:?}"
    );
    let stale: Vec<_> = acl.difference(&registered).collect();
    assert!(
        stale.is_empty(),
        "remove these from permissions/app-commands.toml: {stale:?}"
    );
}
