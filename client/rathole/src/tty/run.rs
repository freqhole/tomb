//! tty event loop. follows the ratatui idiom: `EventStream` for
//! crossterm input + `tokio::select!` for ticks and background-task
//! actions, redraw on each iteration.
//!
//! owns the bootstrap: builds the command list from grimoire's
//! registry, loads the statefile, constructs the `LocalTransport`,
//! then drives `ratcore::App`.

use crossterm::event::{Event, EventStream, KeyCode, KeyEventKind, KeyModifiers};
use futures::StreamExt;
use std::rc::Rc;
use std::time::Duration;
use tokio::sync::mpsc;
use tokio::task::LocalSet;

use super::persist;
use super::transport::LocalTransport;
use super::LaunchOpts;
use crate::ratcore::app::{
    AdminCommand, App, AppAction, AppState, Focus, LastDispatch, PersistedState,
};
use crate::ratcore::transport::Transport;
use crate::ratcore::views;

/// build the seed command list from grimoire's registry.
fn build_commands() -> Vec<AdminCommand> {
    grimoire::admin_dispatch::registry::all_commands()
        .iter()
        .map(|c| AdminCommand {
            name: c.name.to_string(),
            request_type: c.request_type.to_string(),
            response_type: c.response_type.to_string(),
            auth: c.auth.as_str().to_string(),
        })
        .collect()
}

pub async fn run(terminal: ratatui::DefaultTerminal, _opts: LaunchOpts) -> color_eyre::Result<()> {
    // wrap in a LocalSet so we can use `tokio::task::spawn_local` —
    // the `Transport` trait is `?Send` (matches the wasm shell's
    // single-threaded constraint) so we can't use `tokio::spawn`.
    let local = LocalSet::new();
    local.run_until(run_inner(terminal)).await
}

async fn run_inner(mut terminal: ratatui::DefaultTerminal) -> color_eyre::Result<()> {
    let commands = build_commands();
    let persisted: PersistedState = persist::load().unwrap_or_else(|e| {
        tracing::warn!("rathole: statefile load failed ({e}); using defaults");
        PersistedState::default()
    });
    let state = AppState::from_persisted(persisted);
    let transport: Rc<dyn Transport> = Rc::new(LocalTransport::from_first_root().await?);
    let mut app = App::new(state, transport, commands);

    let mut events = EventStream::new();
    let mut tick = tokio::time::interval(Duration::from_millis(250));
    let (action_tx, mut action_rx) = mpsc::unbounded_channel::<AppAction>();

    while !app.exit {
        terminal.draw(|f| views::draw(f, &mut app))?;
        tokio::select! {
            maybe_ev = events.next() => match maybe_ev {
                Some(Ok(ev)) => on_event(&mut app, ev, &action_tx),
                Some(Err(e)) => return Err(color_eyre::eyre::eyre!("input stream error: {e}")),
                None => break,
            },
            _ = tick.tick() => {}
            Some(action) = action_rx.recv() => on_action(&mut app, action),
        }
    }

    if let Err(e) = persist::save(&app.state.persisted) {
        tracing::warn!("rathole: statefile save failed: {e}");
    }
    Ok(())
}

fn on_event(app: &mut App, ev: Event, action_tx: &mpsc::UnboundedSender<AppAction>) {
    let Event::Key(k) = ev else { return };
    if k.kind != KeyEventKind::Press {
        return;
    }

    // global hotkeys first
    match (k.code, k.modifiers) {
        (KeyCode::Char('q'), _) | (KeyCode::Char('c'), KeyModifiers::CONTROL) => {
            app.exit = true;
            return;
        }
        _ => {}
    }

    // dispatch to focused area
    match app.state.ephemeral.focus {
        Focus::AdminPalette => on_palette_key(app, k.code, action_tx),
    }
}

fn on_palette_key(app: &mut App, code: KeyCode, action_tx: &mpsc::UnboundedSender<AppAction>) {
    let len = app.commands.len();
    if len == 0 {
        return;
    }
    let selected = app.state.ephemeral.palette_list.selected().unwrap_or(0);
    match code {
        KeyCode::Down | KeyCode::Char('j') => {
            let next = (selected + 1).min(len - 1);
            app.state.ephemeral.palette_list.select(Some(next));
        }
        KeyCode::Up | KeyCode::Char('k') => {
            let next = selected.saturating_sub(1);
            app.state.ephemeral.palette_list.select(Some(next));
        }
        KeyCode::Home | KeyCode::Char('g') => {
            app.state.ephemeral.palette_list.select(Some(0));
        }
        KeyCode::End | KeyCode::Char('G') => {
            app.state.ephemeral.palette_list.select(Some(len - 1));
        }
        KeyCode::Enter => {
            // m0: dispatch with empty args. typed forms arrive in m1.
            let cmd = app.commands[selected].name.clone();
            let transport = app.transport.clone();
            let tx = action_tx.clone();
            tokio::task::spawn_local(async move {
                let response = transport.admin_dispatch(&cmd, serde_json::json!({})).await;
                let _ = tx.send(AppAction::AdminDispatchResult {
                    command: cmd,
                    response,
                });
            });
        }
        _ => {}
    }
}

fn on_action(app: &mut App, action: AppAction) {
    match action {
        AppAction::AdminDispatchResult { command, response } => {
            let data_pretty = response
                .data
                .as_ref()
                .map(|d| serde_json::to_string_pretty(d).unwrap_or_else(|_| d.to_string()));
            app.state.ephemeral.last_dispatch = Some(LastDispatch {
                command,
                success: response.success,
                message: response.message,
                data_pretty,
            });
        }
    }
}
