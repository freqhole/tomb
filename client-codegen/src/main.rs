//! client codegen - generates typescript api clients from rust route definitions

mod generator;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args().collect();
    let mode = args.get(1).map(|s| s.as_str()).unwrap_or("help");

    match mode {
        "generate" | "codegen" => generator::generate_all(),
        _ => {
            println!("usage: cargo run -- generate");
            println!("  generates typescript client in freqhole-api-client/src/codegen/");
            Ok(())
        }
    }
}
