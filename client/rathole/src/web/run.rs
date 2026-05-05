//! ratzilla-backed event loop for the browser. uses ratzilla's
//! webgl2 backend (renders into a `<canvas>` via beamterm).

use ratzilla::{event::KeyCode, WebGl2Backend, WebRenderer};
use std::cell::RefCell;
use std::rc::Rc;
use wasm_bindgen::prelude::*;

use crate::ratcore::app::{AdminCommand, App, AppState, Focus, PersistedState};
use crate::ratcore::transport::Transport;
use crate::ratcore::views;
use crate::web::transport::NoopTransport;

/// hardcoded sample command list for the spike. once we have a
/// real transport, this comes from a remote `list_admin_commands`
/// dispatch (added to grimoire in m1+).
fn sample_commands() -> Vec<AdminCommand> {
    vec![
        AdminCommand {
            name: "list_users".to_string(),
            request_type: "()".to_string(),
            response_type: "Vec<User>".to_string(),
            auth: "Root".to_string(),
        },
        AdminCommand {
            name: "list_remotes".to_string(),
            request_type: "()".to_string(),
            response_type: "Vec<Remote>".to_string(),
            auth: "Authenticated".to_string(),
        },
        AdminCommand {
            name: "ping".to_string(),
            request_type: "()".to_string(),
            response_type: "Pong".to_string(),
            auth: "Public".to_string(),
        },
    ]
}

/// wasm entry. invoked from js after the module loads.
#[wasm_bindgen]
pub fn start() -> Result<(), JsValue> {
    console_error_panic_hook::set_once();

    let backend = WebGl2Backend::new()
        .map_err(|e| JsValue::from_str(&format!("webgl2 backend init: {e}")))?;
    let mut terminal = ratatui::Terminal::new(backend)
        .map_err(|e| JsValue::from_str(&format!("terminal init: {e}")))?;

    let state = AppState::from_persisted(PersistedState::default());
    let transport: Rc<dyn Transport> = Rc::new(NoopTransport);
    let app = Rc::new(RefCell::new(App::new(state, transport, sample_commands())));

    // input: route key events to the same palette handlers used by tty.
    let app_for_input = app.clone();
    terminal
        .on_key_event(move |ev| {
            let mut app = app_for_input.borrow_mut();
            on_key(&mut app, ev.code);
        })
        .map_err(|e| JsValue::from_str(&format!("on_key_event: {e}")))?;

    // render loop: ratzilla drives this via requestAnimationFrame.
    let app_for_draw = app.clone();
    terminal.draw_web(move |frame| {
        let mut app = app_for_draw.borrow_mut();
        views::draw(frame, &mut app);
    });

    Ok(())
}

fn on_key(app: &mut App, code: KeyCode) {
    let len = app.commands.len();
    if len == 0 {
        return;
    }

    match app.state.ephemeral.focus {
        Focus::AdminPalette => {
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
                    // m0 spike: synchronously stash the noop response.
                    // real async dispatch lands when MiddenTransport arrives.
                    let cmd = app.commands[selected].name.clone();
                    app.state.ephemeral.last_dispatch = Some(crate::ratcore::app::LastDispatch {
                        command: cmd,
                        success: false,
                        message: "not connected — wasm spike, m0".to_string(),
                        data_pretty: None,
                    });
                }
                _ => {}
            }
        }
    }
}
