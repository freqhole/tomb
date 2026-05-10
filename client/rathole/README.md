# rathole

ratatui-based terminal client for freqhole. complements `freqhole`
cli + charnel wizard. aimed at power users.

see [docs/TUI_PLAN.md](../../docs/TUI_PLAN.md) for the full plan.

## status

m0 — scaffold + admin shell. local in-process transport only.
launches via `freqhole rathole`.

## run

```sh
cargo run -p rathole
# or
cargo run --bin freqhole -- rathole
```

## conventions

- lowercase prose
- no emojis in code
- lean into ratatui idioms (`ratatui::init()`, `Layout::vertical(...)
.areas(...)`, `Stylize`, built-in `ListState`/`TableState`,
  `EventStream` + `tokio::select!`, `KeyEventKind::Press` filter)
- lean into existing freqhole abstractions (`grimoire::admin_dispatch`,
  `grimoire::remotez::Remote`, `UserService::get_first_root_user`,
  `SetupService::run_setup`)
- no "native" terminology in code or docs — say "binary build" vs
  "wasm build" if a distinction is ever needed
