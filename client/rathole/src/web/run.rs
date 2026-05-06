//! ratzilla-backed event loop for the browser. uses ratzilla's
//! webgl2 backend (renders into a `<canvas>` via beamterm).
//!
//! at startup we either restore our iroh keypair from IndexedDB or
//! generate one and persist it (see `web::identity`). the live
//! `MiddenNode` is stored in the closure environment so the peer-input
//! modal can rebuild a `MiddenTransport` against any pasted node id.
//!
//! transport selection:
//! - if `?peer=<addr>` is in the url, auto-connect at startup
//! - otherwise the palette renders with `NoopTransport` and the user
//!   presses `p` to enter a node id (no query param required)

use futures::channel::mpsc;
use midden::MiddenNode;
use ratzilla::{event::KeyCode, WebGl2Backend, WebRenderer};
use std::cell::RefCell;
use std::rc::Rc;
use wasm_bindgen::prelude::*;

use crate::ratcore::app::{
    AdminCommand, App, AppAction, AppState, ArgKind, CommandForm, CommandKind, FieldState, Focus,
    LastDispatch, PersistedState, SelectOption,
};
use crate::ratcore::transport::Transport;
use crate::ratcore::views;
use crate::ratcore::views::command_form;
use crate::web::identity;
use crate::web::transport::{MiddenTransport, NoopTransport};

/// build the seed command list. shared with the tty shell via
/// `ratcore::catalog`. wasm can't link grimoire's registry (sqlx
/// & tokio-multi-thread aren't wasm-safe), so the catalog is the
/// single source of truth here.
fn sample_commands() -> Vec<AdminCommand> {
    crate::ratcore::catalog::commands()
}

/// wasm entry. invoked from js after the module loads. async because
/// `MiddenNode::create()` is async — the returned `Promise` resolves
/// once the iroh endpoint is bound and the relay (if any) connected.
///
/// note: named `boot` (not `start`) to avoid colliding with midden's
/// `#[wasm_bindgen(start)]` describe symbol when both crates are linked.
#[wasm_bindgen]
pub async fn boot() -> Result<(), JsValue> {
    console_error_panic_hook::set_once();

    let backend = WebGl2Backend::new()
        .map_err(|e| JsValue::from_str(&format!("webgl2 backend init: {e}")))?;
    let mut terminal = ratatui::Terminal::new(backend)
        .map_err(|e| JsValue::from_str(&format!("terminal init: {e}")))?;

    // load or create our iroh keypair (persisted in IndexedDB at the
    // same path spume uses, so they share creds when same-origin).
    let (node, local_node_id) = identity::load_or_create_node().await?;
    let node = Rc::new(node);

    // initial transport: if `?peer=<addr>` is in the url, auto-connect.
    let initial_peer = read_url_param("peer");
    let (transport, connected_peer): (Rc<dyn Transport>, Option<String>) = match &initial_peer {
        Some(addr) => (
            Rc::new(MiddenTransport::new(node.clone(), addr.clone())),
            Some(addr.clone()),
        ),
        None => (Rc::new(NoopTransport), None),
    };

    let mut state = AppState::from_persisted(PersistedState::default());
    state.ephemeral.local_node_id = Some(local_node_id);
    state.ephemeral.connected_peer = connected_peer;
    let app = Rc::new(RefCell::new(App::new(state, transport, sample_commands())));

    // background-task → ui channel.
    let (action_tx, action_rx) = mpsc::unbounded::<AppAction>();
    let action_rx = Rc::new(RefCell::new(action_rx));

    // input
    let app_for_input = app.clone();
    let tx_for_input = action_tx.clone();
    let node_for_input = node.clone();
    terminal
        .on_key_event(move |ev| {
            let mut app = app_for_input.borrow_mut();
            on_key(&mut app, ev.code, ev.shift, &tx_for_input, &node_for_input);
        })
        .map_err(|e| JsValue::from_str(&format!("on_key_event: {e}")))?;

    // browser pastes (cmd/ctrl-v, right-click → paste) don't surface
    // through ratzilla's key events. attach a document-level "paste"
    // listener and, if the peer-input modal is focused, append the
    // pasted text to the input buffer.
    install_paste_listener(app.clone())?;

    // render loop
    let app_for_draw = app.clone();
    let rx_for_draw = action_rx.clone();
    terminal.draw_web(move |frame| {
        {
            let mut app = app_for_draw.borrow_mut();
            let mut rx = rx_for_draw.borrow_mut();
            while let Ok(action) = rx.try_recv() {
                on_action(&mut app, action);
            }
        }
        let mut app = app_for_draw.borrow_mut();
        views::draw(frame, &mut app);
    });

    Ok(())
}

fn on_key(
    app: &mut App,
    code: KeyCode,
    shift: bool,
    tx: &mpsc::UnboundedSender<AppAction>,
    node: &Rc<MiddenNode>,
) {
    match app.state.ephemeral.focus {
        Focus::AdminPalette => on_palette_key(app, code, tx),
        Focus::PeerInput => on_peer_input_key(app, code, node),
        Focus::CommandForm => on_form_key(app, code, shift, tx),
        Focus::ResultPanel => on_result_panel_key(app, code, shift),
        Focus::ResultActionMenu => on_action_menu_key(app, code, tx),
    }
}

fn on_palette_key(app: &mut App, code: KeyCode, tx: &mpsc::UnboundedSender<AppAction>) {
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
        KeyCode::Char('p') => {
            // open peer-input modal. seed with currently-connected peer
            // so user can edit instead of retyping.
            let seed = app
                .state
                .ephemeral
                .connected_peer
                .clone()
                .unwrap_or_default();
            let cursor = seed.chars().count();
            app.state.ephemeral.peer_input = seed;
            app.state.ephemeral.peer_cursor = cursor;
            app.state.ephemeral.peer_error = None;
            app.state.ephemeral.focus = Focus::PeerInput;
        }
        KeyCode::Char('[') => {
            app.state.ephemeral.last_dispatch_scroll =
                app.state.ephemeral.last_dispatch_scroll.saturating_sub(1);
        }
        KeyCode::Char(']') => {
            // upper bound clamping happens in the renderer (it knows the
            // viewport height), so we just bump optimistically here.
            app.state.ephemeral.last_dispatch_scroll =
                app.state.ephemeral.last_dispatch_scroll.saturating_add(1);
        }
        KeyCode::Char('\\') => {
            app.state.ephemeral.last_dispatch_scroll = 0;
        }
        KeyCode::Tab => {
            // hand focus to the result panel so arrow keys scroll it.
            app.state.ephemeral.focus = Focus::ResultPanel;
        }
        KeyCode::Enter => {
            let cmd = app.commands[selected].clone();
            // commands with args open an inline form; no-arg commands
            // dispatch immediately with `{}`.
            if !cmd.args.is_empty() {
                if matches!(cmd.kind, CommandKind::Public { .. })
                    && app.state.ephemeral.connected_peer.is_none()
                {
                    app.state.ephemeral.last_dispatch = Some(LastDispatch {
                        command: cmd.name,
                        success: false,
                        message: "set a peer first (press p)".to_string(),
                        data_pretty: None,
                        rows: Vec::new(),
                        cursor: 0,
                    });
                    return;
                }
                app.state.ephemeral.form = Some(CommandForm::new(&cmd));
                app.state.ephemeral.focus = Focus::CommandForm;
                maybe_fetch_select_options(app, tx);
                return;
            }
            let transport = app.transport.clone();
            let name = cmd.name.clone();
            let kind = cmd.kind.clone();
            let tx = tx.clone();
            wasm_bindgen_futures::spawn_local(async move {
                let response = match kind {
                    CommandKind::Admin => {
                        transport.admin_dispatch(&name, serde_json::json!({})).await
                    }
                    CommandKind::Public { route, method } => {
                        transport
                            .public_dispatch(&method, &route, serde_json::json!({}))
                            .await
                    }
                };
                let _ = tx.unbounded_send(AppAction::AdminDispatchResult {
                    command: name,
                    response,
                });
            });
        }
        _ => {}
    }
}

fn on_peer_input_key(app: &mut App, code: KeyCode, node: &Rc<MiddenNode>) {
    use crate::ratcore::text_input as ti;
    let eph = &mut app.state.ephemeral;
    match code {
        KeyCode::Esc => {
            eph.focus = Focus::AdminPalette;
            eph.peer_error = None;
        }
        KeyCode::Backspace => ti::backspace(&mut eph.peer_input, &mut eph.peer_cursor),
        KeyCode::Delete => ti::delete(&mut eph.peer_input, &mut eph.peer_cursor),
        KeyCode::Left => ti::move_left(&mut eph.peer_cursor),
        KeyCode::Right => ti::move_right(&eph.peer_input, &mut eph.peer_cursor),
        KeyCode::Home => ti::move_home(&mut eph.peer_cursor),
        KeyCode::End => ti::move_end(&eph.peer_input, &mut eph.peer_cursor),
        KeyCode::Enter => {
            let addr = eph.peer_input.trim().to_string();
            if addr.is_empty() {
                eph.peer_error = Some("peer addr is empty".to_string());
                return;
            }
            // build a fresh MiddenTransport against the entered addr
            // and swap it into the app. dispatch happens lazily on
            // first admin command, so no async work needed here.
            app.transport = Rc::new(MiddenTransport::new(node.clone(), addr.clone()));
            let eph = &mut app.state.ephemeral;
            eph.connected_peer = Some(addr);
            eph.peer_input.clear();
            eph.peer_cursor = 0;
            eph.peer_error = None;
            eph.focus = Focus::AdminPalette;
        }
        KeyCode::Char(c) => {
            if !c.is_control() {
                ti::insert_char(&mut eph.peer_input, &mut eph.peer_cursor, c);
            }
        }
        _ => {}
    }
}

fn on_result_panel_key(app: &mut App, code: KeyCode, shift: bool) {
    let eph = &mut app.state.ephemeral;
    let step: u16 = if shift { 10 } else { 1 };
    let has_rows = eph
        .last_dispatch
        .as_ref()
        .map(|ld| !ld.rows.is_empty())
        .unwrap_or(false);
    match code {
        KeyCode::Esc | KeyCode::Tab => eph.focus = Focus::AdminPalette,
        KeyCode::Up | KeyCode::Char('k') => {
            if has_rows {
                if let Some(ld) = eph.last_dispatch.as_mut() {
                    ld.cursor = ld.cursor.saturating_sub(step as usize);
                }
            } else {
                eph.last_dispatch_scroll = eph.last_dispatch_scroll.saturating_sub(step);
            }
        }
        KeyCode::Down | KeyCode::Char('j') => {
            if has_rows {
                if let Some(ld) = eph.last_dispatch.as_mut() {
                    let max = ld.rows.len().saturating_sub(1);
                    ld.cursor = (ld.cursor + step as usize).min(max);
                }
            } else {
                eph.last_dispatch_scroll = eph.last_dispatch_scroll.saturating_add(step);
            }
        }
        KeyCode::Enter | KeyCode::Char('a') => {
            if let Some(ld) = eph.last_dispatch.as_ref() {
                if let Some(row) = ld.rows.get(ld.cursor) {
                    let actions =
                        crate::ratcore::catalog::result_actions(&ld.command);
                    if !actions.is_empty() {
                        eph.action_menu = Some(crate::ratcore::app::ActionMenu {
                            source_command: ld.command.clone(),
                            row: row.clone(),
                            options: actions,
                            selected: 0,
                        });
                        eph.focus = Focus::ResultActionMenu;
                    }
                }
            }
        }
        KeyCode::PageUp => {
            eph.last_dispatch_scroll = eph.last_dispatch_scroll.saturating_sub(10);
        }
        KeyCode::PageDown => {
            eph.last_dispatch_scroll = eph.last_dispatch_scroll.saturating_add(10);
        }
        KeyCode::Home | KeyCode::Char('g') => {
            eph.last_dispatch_scroll = 0;
        }
        KeyCode::End | KeyCode::Char('G') => {
            // big number; renderer clamps to max.
            eph.last_dispatch_scroll = u16::MAX;
        }
        _ => {}
    }
}

fn on_form_key(app: &mut App, code: KeyCode, _shift: bool, tx: &mpsc::UnboundedSender<AppAction>) {
    use crate::ratcore::text_input as ti;
    let Some(form) = app.state.ephemeral.form.as_mut() else {
        app.state.ephemeral.focus = Focus::AdminPalette;
        return;
    };
    if form.inflight {
        // ignore everything except esc while a submit is in flight.
        if code == KeyCode::Esc {
            app.state.ephemeral.form = None;
            app.state.ephemeral.focus = Focus::AdminPalette;
        }
        return;
    }

    // confirm step: Enter submits, Esc returns to the last field.
    if form.confirming {
        match code {
            KeyCode::Enter => submit_form(app, tx),
            KeyCode::Esc => {
                form.confirming = false;
                form.error = None;
            }
            _ => {}
        }
        return;
    }

    // wizard step. Enter advances (and submits via the confirm
    // step on the last field). Esc cancels. ←/→ cycles options on
    // the focused OneOf / SelectFrom; cursor on Text. printable
    // chars / backspace / delete edit the focused Text field.
    match code {
        KeyCode::Esc => {
            app.state.ephemeral.form = None;
            app.state.ephemeral.focus = Focus::AdminPalette;
        }
        // Tab advances regardless of focused field (handy when the
        // focused field is a LongText editor where Enter inserts a
        // newline).
        KeyCode::Tab => advance_form(app, tx),
        KeyCode::Enter => {
            let is_long = form
                .fields
                .get(form.focused)
                .map(|f| matches!(f, FieldState::LongText { .. }))
                .unwrap_or(false);
            if is_long {
                if let Some(FieldState::LongText { buf, cursor }) =
                    form.fields.get_mut(form.focused)
                {
                    ti::insert_char(buf, cursor, '\n');
                }
            } else {
                advance_form(app, tx);
            }
        }
        _ => {
            let Some(state) = form.fields.get_mut(form.focused) else {
                return;
            };
            match (state, &code) {
                (FieldState::Text { buf, cursor }, KeyCode::Backspace) => {
                    ti::backspace(buf, cursor)
                }
                (FieldState::Text { buf, cursor }, KeyCode::Delete) => ti::delete(buf, cursor),
                (FieldState::Text { cursor, .. }, KeyCode::Left) => ti::move_left(cursor),
                (FieldState::Text { buf, cursor }, KeyCode::Right) => ti::move_right(buf, cursor),
                (FieldState::Text { cursor, .. }, KeyCode::Home) => ti::move_home(cursor),
                (FieldState::Text { buf, cursor }, KeyCode::End) => ti::move_end(buf, cursor),
                (FieldState::Text { buf, cursor }, KeyCode::Char(c)) => {
                    if !c.is_control() {
                        ti::insert_char(buf, cursor, *c);
                    }
                }
                // LongText shares Text's text-edit keys; Enter is
                // handled above (newline) and Tab advances.
                (FieldState::LongText { buf, cursor }, KeyCode::Backspace) => {
                    ti::backspace(buf, cursor)
                }
                (FieldState::LongText { buf, cursor }, KeyCode::Delete) => {
                    ti::delete(buf, cursor)
                }
                (FieldState::LongText { cursor, .. }, KeyCode::Left) => ti::move_left(cursor),
                (FieldState::LongText { buf, cursor }, KeyCode::Right) => {
                    ti::move_right(buf, cursor)
                }
                (FieldState::LongText { cursor, .. }, KeyCode::Home) => ti::move_home(cursor),
                (FieldState::LongText { buf, cursor }, KeyCode::End) => {
                    ti::move_end(buf, cursor)
                }
                (FieldState::LongText { buf, cursor }, KeyCode::Char(c)) => {
                    if !c.is_control() {
                        ti::insert_char(buf, cursor, *c);
                    }
                }
                (FieldState::Number { buf, cursor, .. }, KeyCode::Backspace) => {
                    ti::backspace(buf, cursor)
                }
                (FieldState::Number { buf, cursor, .. }, KeyCode::Delete) => {
                    ti::delete(buf, cursor)
                }
                (FieldState::Number { cursor, .. }, KeyCode::Left) => ti::move_left(cursor),
                (FieldState::Number { buf, cursor, .. }, KeyCode::Right) => {
                    ti::move_right(buf, cursor)
                }
                (FieldState::Number { cursor, .. }, KeyCode::Home) => ti::move_home(cursor),
                (FieldState::Number { buf, cursor, .. }, KeyCode::End) => ti::move_end(buf, cursor),
                (
                    FieldState::Number {
                        buf,
                        cursor,
                        signed,
                    },
                    KeyCode::Char(c),
                ) => {
                    if c.is_ascii_digit()
                        || (*signed && *c == '-' && *cursor == 0 && !buf.starts_with('-'))
                    {
                        ti::insert_char(buf, cursor, *c);
                    }
                }
                (FieldState::Bool { value }, KeyCode::Left)
                | (FieldState::Bool { value }, KeyCode::Right)
                | (FieldState::Bool { value }, KeyCode::Char(' ')) => {
                    *value = !*value;
                }
                (FieldState::OptionalBool { value }, KeyCode::Left) => {
                    *value = match value {
                        None => Some(false),
                        Some(true) => None,
                        Some(false) => Some(true),
                    };
                }
                (FieldState::OptionalBool { value }, KeyCode::Right)
                | (FieldState::OptionalBool { value }, KeyCode::Char(' ')) => {
                    *value = match value {
                        None => Some(true),
                        Some(true) => Some(false),
                        Some(false) => None,
                    };
                }
                (FieldState::OneOf { selected }, KeyCode::Left) => {
                    *selected = selected.saturating_sub(1);
                }
                (FieldState::OneOf { selected }, KeyCode::Right) => {
                    *selected = selected.saturating_add(1);
                    // bound check happens at submit time via build_body's choices lookup
                }
                (
                    FieldState::SelectFrom {
                        options, selected, ..
                    },
                    KeyCode::Left,
                ) => {
                    if options.is_some() {
                        *selected = selected.saturating_sub(1);
                    }
                }
                (
                    FieldState::SelectFrom {
                        options, selected, ..
                    },
                    KeyCode::Right,
                ) => {
                    if let Some(opts) = options {
                        if !opts.is_empty() {
                            *selected = (*selected + 1).min(opts.len() - 1);
                        }
                    }
                }
                _ => {}
            }
        }
    }
}

/// Enter pressed on a wizard field: validate it locally, then
/// advance to the next field — or to the confirm step if we're on
/// the last one. SelectFrom fields auto-fetch on focus.
fn advance_form(app: &mut App, tx: &mpsc::UnboundedSender<AppAction>) {
    let Some(form) = app.state.ephemeral.form.as_mut() else {
        return;
    };
    if let Err(msg) = validate_focused(form) {
        form.error = Some(msg);
        return;
    }
    form.error = None;
    if form.is_last_focusable() {
        form.confirming = true;
    } else {
        form.focus_next();
        maybe_fetch_select_options(app, tx);
    }
}

/// validate just the currently-focused field, used by the wizard
/// to gate Enter advancement. SelectFrom blocks until options are
/// loaded; everything else accepts here and lets `build_body`
/// reject required-but-empty at confirm time.
fn validate_focused(form: &CommandForm) -> Result<(), String> {
    let Some(state) = form.fields.get(form.focused) else {
        return Ok(());
    };
    let label = format!("field {}", form.focused + 1);
    match state {
        FieldState::Text { .. }
        | FieldState::LongText { .. }
        | FieldState::Number { .. }
        | FieldState::Bool { .. }
        | FieldState::OptionalBool { .. }
        | FieldState::OneOf { .. }
        | FieldState::HiddenLocalNodeId
        | FieldState::Mirror => Ok(()),
        FieldState::SelectFrom {
            options,
            loading,
            error,
            ..
        } => {
            if *loading {
                return Err(format!("{} is still loading", label));
            }
            if let Some(e) = error {
                return Err(format!("{}: {}", label, e));
            }
            match options {
                Some(opts) if opts.is_empty() => {
                    Err(format!("{} has no options to pick from", label))
                }
                Some(_) => Ok(()),
                None => Err(format!("{} not loaded yet", label)),
            }
        }
    }
}

/// the result-pane action menu accepts up/down to navigate, Enter
/// to pick (opens the target command's form prefilled with the
/// row), and Esc to dismiss back to the result panel.
fn on_action_menu_key(
    app: &mut App,
    code: KeyCode,
    tx: &mpsc::UnboundedSender<AppAction>,
) {
    let eph = &mut app.state.ephemeral;
    let Some(menu) = eph.action_menu.as_mut() else {
        eph.focus = Focus::ResultPanel;
        return;
    };
    match code {
        KeyCode::Esc => {
            eph.action_menu = None;
            eph.focus = Focus::ResultPanel;
        }
        KeyCode::Up | KeyCode::Char('k') => {
            menu.selected = menu.selected.saturating_sub(1);
        }
        KeyCode::Down | KeyCode::Char('j') => {
            let max = menu.options.len().saturating_sub(1);
            menu.selected = (menu.selected + 1).min(max);
        }
        KeyCode::Enter => {
            let Some(opt) = menu.options.get(menu.selected).cloned() else {
                return;
            };
            let row = menu.row.clone();
            eph.action_menu = None;
            let Some(cmd) = app
                .commands
                .iter()
                .find(|c| c.name == opt.target_command)
                .cloned()
            else {
                eph.focus = Focus::ResultPanel;
                return;
            };
            app.state.ephemeral.form =
                Some(crate::ratcore::app::CommandForm::new_with_prefill(&cmd, &row));
            app.state.ephemeral.focus = Focus::CommandForm;
            maybe_fetch_select_options(app, tx);
        }
        _ => {}
    }
}

/// validate + serialize the form, then dispatch via the channel
/// matching the command's `CommandKind`. on completion, the result
/// arrives via `AppAction::AdminDispatchResult` and `on_action`
/// closes the form.
fn submit_form(app: &mut App, tx: &mpsc::UnboundedSender<AppAction>) {
    let Some(form) = app.state.ephemeral.form.as_ref() else {
        return;
    };
    let Some(cmd) = app
        .commands
        .iter()
        .find(|c| c.name == form.command)
        .cloned()
    else {
        return;
    };
    let local_node_id = app.state.ephemeral.local_node_id.as_deref();
    let body = match command_form::build_body(&cmd, form, local_node_id) {
        Ok(b) => b,
        Err(msg) => {
            if let Some(f) = app.state.ephemeral.form.as_mut() {
                f.error = Some(msg);
            }
            return;
        }
    };
    if let Some(f) = app.state.ephemeral.form.as_mut() {
        f.inflight = true;
        f.error = None;
    }
    let transport = app.transport.clone();
    let name = cmd.name.clone();
    let kind = cmd.kind.clone();
    let tx = tx.clone();
    wasm_bindgen_futures::spawn_local(async move {
        let response = match kind {
            CommandKind::Admin => transport.admin_dispatch(&name, body).await,
            CommandKind::Public { route, method } => {
                transport.public_dispatch(&method, &route, body).await
            }
        };
        let _ = tx.unbounded_send(AppAction::AdminDispatchResult {
            command: name,
            response,
        });
    });
}

/// if the form's currently-focused field is a `SelectFrom` whose
/// options haven't been fetched yet, kick off the source command and
/// flag the field as `loading`. result arrives via
/// `AppAction::SelectFromOptionsReady` and is applied in `on_action`.
fn maybe_fetch_select_options(app: &mut App, tx: &mpsc::UnboundedSender<AppAction>) {
    let Some(form) = app.state.ephemeral.form.as_mut() else {
        return;
    };
    let cmd_name = form.command.clone();
    let field_idx = form.focused;
    let Some(state) = form.fields.get(field_idx) else {
        return;
    };
    if !matches!(state, FieldState::SelectFrom { .. }) {
        return;
    }
    let Some(cmd) = app.commands.iter().find(|c| c.name == cmd_name).cloned() else {
        return;
    };
    let Some(spec) = cmd.args.get(field_idx).cloned() else {
        return;
    };
    let ArgKind::SelectFrom {
        source_command,
        source_body,
        body_from_fields,
        data_path,
        value_field,
        label_field,
    } = spec.kind
    else {
        return;
    };
    let depends_on_siblings = !body_from_fields.is_empty();
    let needs_fetch = if let Some(FieldState::SelectFrom {
        options, loading, ..
    }) = form.fields.get_mut(field_idx)
    {
        if *loading {
            false
        } else if depends_on_siblings {
            *options = None;
            true
        } else {
            options.is_none()
        }
    } else {
        false
    };
    if !needs_fetch {
        return;
    }
    let body = match crate::ratcore::views::command_form::build_select_source_body(
        &cmd,
        form,
        &source_body,
        &body_from_fields,
    ) {
        Ok(b) => b,
        Err(msg) => {
            if let Some(FieldState::SelectFrom { error, .. }) =
                form.fields.get_mut(field_idx)
            {
                *error = Some(msg);
            }
            return;
        }
    };
    if let Some(FieldState::SelectFrom { loading, error, .. }) =
        form.fields.get_mut(field_idx)
    {
        *loading = true;
        *error = None;
    }
    let transport = app.transport.clone();
    let tx = tx.clone();
    wasm_bindgen_futures::spawn_local(async move {
        let response = transport.admin_dispatch(&source_command, body).await;
        let options = if !response.success {
            Err(response.message)
        } else {
            extract_options(
                response.data.as_ref(),
                &data_path,
                &value_field,
                &label_field,
            )
        };
        let _ = tx.unbounded_send(AppAction::SelectFromOptionsReady {
            command: cmd_name,
            field_index: field_idx,
            options,
        });
    });
}

/// walk `data` along `data_path` (dot-separated, "" = root) to a JSON
/// array, then build `SelectOption`s from each element by reading the
/// `value_field` and `label_field` keys. label falls back to value
/// if the label field is missing.
fn extract_options(
    data: Option<&serde_json::Value>,
    data_path: &str,
    value_field: &str,
    label_field: &str,
) -> Result<Vec<SelectOption>, String> {
    let Some(mut node) = data else {
        return Err("source command returned no data".to_string());
    };
    if !data_path.is_empty() {
        for seg in data_path.split('.') {
            node = node
                .get(seg)
                .ok_or_else(|| format!("data_path: missing `{}`", seg))?;
        }
    }
    let arr = node
        .as_array()
        .ok_or_else(|| "source data is not an array".to_string())?;
    let mut out = Vec::with_capacity(arr.len());
    for el in arr {
        let value = el
            .get(value_field)
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| format!("missing `{}` on element", value_field))?
            .to_string();
        let label = el
            .get(label_field)
            .and_then(serde_json::Value::as_str)
            .map(str::to_string)
            .unwrap_or_else(|| value.clone());
        out.push(SelectOption {
            value,
            label,
            row: el.clone(),
        });
    }
    Ok(out)
}

fn on_action(app: &mut App, action: AppAction) {
    match action {
        AppAction::AdminDispatchResult { command, response } => {
            let data_pretty = response
                .data
                .as_ref()
                .map(|d| serde_json::to_string_pretty(d).unwrap_or_else(|_| d.to_string()));

            // if this was a knock submission and it succeeded, surface
            // the returned id in the header bar.
            if command == "knock" && response.success {
                if let Some(id) = response
                    .data
                    .as_ref()
                    .and_then(|d| d.get("id"))
                    .and_then(serde_json::Value::as_str)
                {
                    app.state.ephemeral.last_knock_id = Some(id.to_string());
                }
            }

            // close any open form and return to palette focus. on
            // failure, surface the message in the form so the user can
            // edit and retry instead — but only when the dispatch was
            // for the form's command.
            let close_form = response.success
                || app
                    .state
                    .ephemeral
                    .form
                    .as_ref()
                    .map(|f| f.command != command)
                    .unwrap_or(true);
            if close_form {
                app.state.ephemeral.form = None;
                if app.state.ephemeral.focus == Focus::CommandForm {
                    app.state.ephemeral.focus = Focus::AdminPalette;
                }
            } else if let Some(form) = app.state.ephemeral.form.as_mut() {
                form.inflight = false;
                form.error = Some(response.message.clone());
            }

            app.state.ephemeral.last_dispatch_scroll = 0;
            let rows = response
                .data
                .as_ref()
                .and_then(|d| d.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter(|v| v.is_object())
                        .cloned()
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            app.state.ephemeral.last_dispatch = Some(LastDispatch {
                command,
                success: response.success,
                message: response.message,
                data_pretty,
                rows,
                cursor: 0,
            });
        }
        AppAction::PeerConnectResult { peer_addr, error } => match error {
            Some(e) => app.state.ephemeral.peer_error = Some(e),
            None => app.state.ephemeral.connected_peer = Some(peer_addr),
        },
        AppAction::LocalNodeReady { node_id } => {
            app.state.ephemeral.local_node_id = Some(node_id);
        }
        AppAction::SelectFromOptionsReady {
            command,
            field_index,
            options,
        } => {
            let Some(form) = app.state.ephemeral.form.as_mut() else {
                return;
            };
            if form.command != command {
                return;
            }
            let Some(field) = form.fields.get_mut(field_index) else {
                return;
            };
            let FieldState::SelectFrom {
                options: opts,
                loading,
                error,
                selected,
            } = field
            else {
                return;
            };
            *loading = false;
            match options {
                Ok(list) => {
                    *selected = 0;
                    *error = None;
                    *opts = Some(list);
                }
                Err(e) => {
                    *error = Some(e);
                }
            }
        }
    }
}

fn read_url_param(name: &str) -> Option<String> {
    let win = web_sys::window()?;
    let search = win.location().search().ok()?;
    let params = web_sys::UrlSearchParams::new_with_str(&search).ok()?;
    let val = params.get(name)?;
    if val.is_empty() {
        None
    } else {
        Some(val)
    }
}

/// attach a document-level "paste" listener that, when the peer-input
/// modal is focused, appends the pasted text into the input buffer.
/// the closure is leaked (`forget`) so it lives for the page's
/// lifetime — there's no teardown path for `boot()` anyway.
fn install_paste_listener(app: Rc<RefCell<App>>) -> Result<(), JsValue> {
    use crate::ratcore::text_input as ti;

    let win = web_sys::window().ok_or_else(|| JsValue::from_str("no window"))?;
    let doc = win
        .document()
        .ok_or_else(|| JsValue::from_str("no document"))?;

    // 1. browser-level keydown intercepts (capture phase, runs *before*
    //    ratzilla's bubble-phase listener). two jobs:
    //    a) swallow Cmd-V / Ctrl-V so ratzilla never delivers a stray
    //       `Char('v')` to the input handler when the user actually means
    //       to paste. the browser's native `paste` event still fires.
    //    b) preventDefault on Tab / Shift-Tab so the browser doesn't
    //       move focus off the canvas. ratzilla still gets the keydown
    //       (we don't stop propagation), so our handlers run.
    let app_for_keys = app.clone();
    let key_cb =
        Closure::<dyn FnMut(web_sys::KeyboardEvent)>::new(move |ev: web_sys::KeyboardEvent| {
            let key = ev.key();
            if key == "Tab" {
                // always prevent default — Tab is never useful as
                // browser focus navigation in a single-canvas app.
                ev.prevent_default();
                return;
            }
            if key != "v" && key != "V" {
                return;
            }
            if !ev.meta_key() && !ev.ctrl_key() {
                return;
            }
            let app = app_for_keys.borrow();
            if matches!(
                app.state.ephemeral.focus,
                Focus::PeerInput | Focus::CommandForm
            ) {
                ev.stop_propagation();
            }
        });
    doc.add_event_listener_with_callback_and_bool(
        "keydown",
        key_cb.as_ref().unchecked_ref(),
        true, // capture phase — runs before ratzilla's bubble-phase listener
    )?;
    key_cb.forget();

    // 2. clipboard `paste` event: when the modal is focused, splice
    //    the pasted text into the buffer at the caret.
    let paste_cb =
        Closure::<dyn FnMut(web_sys::ClipboardEvent)>::new(move |ev: web_sys::ClipboardEvent| {
            let mut app = app.borrow_mut();
            let focus = app.state.ephemeral.focus;
            if !matches!(focus, Focus::PeerInput | Focus::CommandForm) {
                return;
            }
            let Some(data) = ev.clipboard_data() else {
                return;
            };
            let Ok(text) = data.get_data("text/plain") else {
                return;
            };
            if text.is_empty() {
                return;
            }
            let eph = &mut app.state.ephemeral;
            match focus {
                Focus::PeerInput => {
                    ti::insert_str(&mut eph.peer_input, &mut eph.peer_cursor, &text);
                }
                Focus::CommandForm => {
                    if let Some(form) = eph.form.as_mut() {
                        match form.fields.get_mut(form.focused) {
                            Some(FieldState::Text { buf, cursor }) => {
                                ti::insert_str(buf, cursor, &text);
                            }
                            Some(FieldState::LongText { buf, cursor }) => {
                                ti::insert_str(buf, cursor, &text);
                            }
                            Some(FieldState::Number {
                                buf,
                                cursor,
                                signed,
                            }) => {
                                // splice only what could conceivably be a
                                // number. drops other chars; keeps a leading
                                // '-' iff signed and we're at position 0.
                                let signed = *signed;
                                let allow_minus = signed && *cursor == 0 && !buf.starts_with('-');
                                let mut filtered = String::new();
                                let mut saw_minus = false;
                                for c in text.chars() {
                                    if c.is_ascii_digit() {
                                        filtered.push(c);
                                    } else if c == '-'
                                        && allow_minus
                                        && !saw_minus
                                        && filtered.is_empty()
                                    {
                                        filtered.push('-');
                                        saw_minus = true;
                                    }
                                }
                                if !filtered.is_empty() {
                                    ti::insert_str(buf, cursor, &filtered);
                                }
                            }
                            _ => {}
                        }
                    }
                }
                _ => {}
            }
            ev.prevent_default();
        });
    doc.add_event_listener_with_callback("paste", paste_cb.as_ref().unchecked_ref())?;
    paste_cb.forget();

    Ok(())
}
