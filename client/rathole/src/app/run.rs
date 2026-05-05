//! event loop. follows the ratatui idiom: `EventStream` for
//! crossterm input + `tokio::select!` for ticks and background-task
//! actions, redraw on each iteration.

use crossterm::event::{Event, EventStream, KeyCode, KeyEventKind, KeyModifiers};
use futures::StreamExt;
use std::time::Duration;
use tokio::sync::mpsc;

use super::events::AppAction;
use super::state::{Focus, LastDispatch};
use super::App;
use crate::transport::Transport;
use crate::views;
use std::sync::Arc;

pub async fn run_loop(
    mut app: App,
    mut terminal: ratatui::DefaultTerminal,
) -> color_eyre::Result<()> {
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

    app.state.save();
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

fn on_palette_key(
    app: &mut App,
    code: KeyCode,
    action_tx: &mpsc::UnboundedSender<AppAction>,
) {
    let commands = grimoire::admin_dispatch::registry::all_commands();
    let len = commands.len();
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
            let cmd = commands[selected].name.to_string();
            let transport: Arc<dyn Transport> = app.transport.clone();
            let tx = action_tx.clone();
            tokio::spawn(async move {
                let response = transport
                    .admin_dispatch(&cmd, serde_json::json!({}))
                    .await;
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
