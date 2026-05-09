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

use crate::ratcore::app::DispatchResponse;
use crate::ratcore::app::{
    AdminCommand, App, AppAction, AppState, ArgKind, CommandForm, CommandKind, FieldState, Focus,
    LastDispatch, PersistedState, RemoteEntry, ReplStatus, SelectOption,
};
use crate::ratcore::transport::Transport;
use crate::ratcore::views;
use crate::ratcore::views::command_form;
use crate::web::identity;
use crate::web::peer_store;
use crate::web::remote_store;
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
    // otherwise fall back to the last peer persisted in IndexedDB so
    // a returning visitor doesn't have to re-paste the node id.
    let initial_peer = match read_url_param("peer") {
        Some(p) => Some(p),
        None => peer_store::load_last_peer().await,
    };
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
    let mut app_inst = App::new(state, transport, sample_commands());

    // background-task → ui channel.
    let (action_tx, action_rx) = mpsc::unbounded::<AppAction>();
    let action_rx = Rc::new(RefCell::new(action_rx));

    // if we auto-connected to a peer, fire `/api/hello` in the
    // background so the top bar can show its friendly name on first
    // paint. silent on failure — header just shows the short node id.
    if let Some(addr) = initial_peer.clone() {
        let node_for_hello = node.clone();
        let tx_for_hello = action_tx.clone();
        wasm_bindgen_futures::spawn_local(async move {
            let t = MiddenTransport::new(node_for_hello, addr.clone());
            if let Ok((name, version, description)) = t.fetch_hello().await {
                // persist to the shared remotes store so this peer
                // shows up in the `r` list view next visit.
                if let Some(n) = name.as_deref().filter(|s| !s.trim().is_empty()) {
                    let _ = remote_store::upsert_remote(&addr, Some(n), true).await;
                } else {
                    let _ = remote_store::upsert_remote(&addr, None, true).await;
                }
                let _ = tx_for_hello.unbounded_send(AppAction::RemoteHello {
                    peer_addr: addr,
                    name,
                    version,
                    description,
                });
            }
        });
    }

    // attach the html-audio backend so the music view + player row
    // can drive playback. failure here is non-fatal — the shell
    // continues without an audio backend (everything else still works).
    match crate::web::player::HtmlAudioPlayer::spawn(action_tx.clone()) {
        Ok(player) => app_inst.player = Some(player),
        Err(e) => web_sys::console::warn_1(
            &format!("rathole: html audio backend init failed: {e}").into(),
        ),
    }
    let app = Rc::new(RefCell::new(app_inst));

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

    // window resize observer: ratzilla's WebGl2Backend already calls
    // `check_canvas_resize()` every draw frame, so the grid does
    // re-fit automatically as the canvas client size changes (driven
    // by our 100vw/100vh CSS in index.html). this listener is mostly
    // a debug hook + future-proofing — log dimensions on resize so we
    // can spot layout glitches, and make sure a draw is queued by
    // dispatching a tiny no-op via requestAnimationFrame.
    install_resize_listener()?;

    // render loop
    let app_for_draw = app.clone();
    let rx_for_draw = action_rx.clone();
    let tx_for_draw = action_tx.clone();
    terminal.draw_web(move |frame| {
        {
            let mut app = app_for_draw.borrow_mut();
            let mut rx = rx_for_draw.borrow_mut();
            while let Ok(action) = rx.try_recv() {
                on_action(&mut app, action, &tx_for_draw);
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
    // pending-quit confirm overlay swallows all keys until resolved.
    if app.state.ephemeral.pending_quit {
        match code {
            KeyCode::Char('y') | KeyCode::Char('Y') | KeyCode::Enter => {
                app.exit = true;
            }
            _ => {
                app.state.ephemeral.pending_quit = false;
            }
        }
        return;
    }
    // global '/' opens the slash repl from any non-text-input
    // focus. mirrors the tty global. text inputs (peer modal,
    // form fields, music search box, repl itself) handle '/' as
    // a literal char.
    if matches!(code, KeyCode::Char('/')) {
        let in_music_text_input = matches!(app.state.ephemeral.focus, Focus::MusicView)
            && matches!(
                app.state.ephemeral.music.mode,
                crate::ratcore::app::MusicMode::Search
            );
        if !matches!(
            app.state.ephemeral.focus,
            Focus::PeerInput | Focus::CommandForm | Focus::Repl
        ) && !in_music_text_input
        {
            crate::ratcore::repl_keys::enter_with_seed(&mut app.state, "/");
            return;
        }
    }
    match app.state.ephemeral.focus {
        Focus::Landing => on_landing_key_web(app, code, tx),
        Focus::AdminPalette => on_palette_key(app, code, tx),
        Focus::PeerInput => on_peer_input_key(app, code, node, tx),
        Focus::RemoteList => on_remote_list_key(app, code, node, tx),
        Focus::CommandForm => on_form_key(app, code, shift, tx),
        Focus::ResultPanel => on_result_panel_key(app, code, shift),
        Focus::ResultActionMenu => on_action_menu_key(app, code, tx),
        // music view: no audio backend on web today; only the search
        // box + result browse work (esc returns to palette).
        Focus::MusicView => on_music_key_web(app, code, tx),
        Focus::Repl => on_repl_key_web(app, code, tx),
        Focus::PlayerRow => on_player_row_key_web(app, code, tx),
    }
}

/// landing-screen key handler (web). landing is intentionally
/// minimal: `/` opens the repl, `q` shows the quit confirm, and
/// everything else is a no-op. all navigation lives in the slash
/// repl now.
fn on_landing_key_web(app: &mut App, code: KeyCode, _action_tx: &mpsc::UnboundedSender<AppAction>) {
    if matches!(code, KeyCode::Char('q')) {
        app.state.ephemeral.pending_quit = true;
    }
}

fn on_palette_key(app: &mut App, code: KeyCode, _tx: &mpsc::UnboundedSender<AppAction>) {
    // mirror tty::on_palette_key — body is just the result viewer
    // now. arrow keys scroll, tab promotes to ResultPanel, esc
    // bails to landing.
    let eph = &mut app.state.ephemeral;
    match code {
        KeyCode::Esc => {
            eph.focus = Focus::Landing;
        }
        KeyCode::Tab => {
            eph.focus = Focus::ResultPanel;
        }
        KeyCode::Up | KeyCode::Char('k') => {
            eph.last_dispatch_scroll = eph.last_dispatch_scroll.saturating_sub(1);
        }
        KeyCode::Down | KeyCode::Char('j') => {
            eph.last_dispatch_scroll = eph.last_dispatch_scroll.saturating_add(1);
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
            eph.last_dispatch_scroll = u16::MAX;
        }
        _ => {}
    }
}

/// open the remotes-list view, kick off an async load from the
/// shared `freqhole_app` IndexedDB, and let the loader fire a
/// `RemotesLoaded` action when ready. the view shows a friendly
/// empty state until the load completes.
fn open_remote_list(app: &mut App, action_tx: &mpsc::UnboundedSender<AppAction>) {
    app.state.ephemeral.focus = Focus::RemoteList;
    app.state.ephemeral.remotes_view_cursor = 0;
    let tx = action_tx.clone();
    wasm_bindgen_futures::spawn_local(async move {
        let _ = tx.unbounded_send(AppAction::RemotesLoaded {
            remotes: load_remotes_view().await,
        });
    });
}

async fn load_remotes_view() -> Vec<RemoteEntry> {
    remote_store::list_remotes()
        .await
        .into_iter()
        .map(|r| RemoteEntry {
            remote_id: r.remote_id,
            name: r.name.unwrap_or_default(),
            transport: r.transport,
            peer_addr: Some(r.peer_addr),
            base_url: None,
            is_active: r.is_active,
            last_connected_at: r.last_connected_at.map(|f| f as i64),
            local_ref: None,
        })
        .collect()
}

fn on_remote_list_key(
    app: &mut App,
    code: KeyCode,
    node: &Rc<MiddenNode>,
    action_tx: &mpsc::UnboundedSender<AppAction>,
) {
    let len = app.state.ephemeral.remotes_view.len();
    match code {
        KeyCode::Esc => {
            app.state.ephemeral.focus = Focus::Landing;
        }
        KeyCode::Up | KeyCode::Char('k') => {
            if len > 0 {
                let cur = app.state.ephemeral.remotes_view_cursor;
                app.state.ephemeral.remotes_view_cursor = cur.saturating_sub(1);
            }
        }
        KeyCode::Down | KeyCode::Char('j') => {
            if len > 0 {
                let cur = app.state.ephemeral.remotes_view_cursor;
                app.state.ephemeral.remotes_view_cursor = (cur + 1).min(len - 1);
            }
        }
        KeyCode::Char('a') => {
            app.state.ephemeral.peer_input.clear();
            app.state.ephemeral.peer_cursor = 0;
            app.state.ephemeral.peer_error = None;
            app.state.ephemeral.focus = Focus::PeerInput;
        }
        KeyCode::Char('d') => {
            let cursor = app.state.ephemeral.remotes_view_cursor;
            if let Some(r) = app.state.ephemeral.remotes_view.get(cursor).cloned() {
                if let Some(addr) = r.peer_addr {
                    let tx = action_tx.clone();
                    wasm_bindgen_futures::spawn_local(async move {
                        if let Err(e) = remote_store::delete_remote(&addr).await {
                            web_sys::console::warn_1(
                                &format!("rathole: delete remote: {e}").into(),
                            );
                        }
                        let _ = tx.unbounded_send(AppAction::RemotesLoaded {
                            remotes: load_remotes_view().await,
                        });
                    });
                }
            }
        }
        KeyCode::Enter => {
            let cursor = app.state.ephemeral.remotes_view_cursor;
            if let Some(r) = app.state.ephemeral.remotes_view.get(cursor).cloned() {
                if let Some(addr) = r.peer_addr {
                    connect_to_peer(app, node, action_tx, addr, r.name);
                }
            }
        }
        _ => {}
    }
}

/// shared connect helper used by both the peer-input modal and the
/// remotes-list view. swaps the transport, persists last-peer +
/// remote record, and fires the hello fetch.
fn connect_to_peer(
    app: &mut App,
    node: &Rc<MiddenNode>,
    action_tx: &mpsc::UnboundedSender<AppAction>,
    addr: String,
    known_name: String,
) {
    let transport = Rc::new(MiddenTransport::new(node.clone(), addr.clone()));
    app.transport = transport.clone();
    let eph = &mut app.state.ephemeral;
    eph.connected_peer = Some(addr.clone());
    eph.remote_name = if known_name.is_empty() {
        None
    } else {
        Some(known_name.clone())
    };
    eph.peer_input.clear();
    eph.peer_cursor = 0;
    eph.peer_error = None;
    eph.focus = Focus::AdminPalette;

    let addr_for_save = addr.clone();
    wasm_bindgen_futures::spawn_local(async move {
        peer_store::save_last_peer(&addr_for_save).await;
    });

    let pre_name = if known_name.is_empty() {
        None
    } else {
        Some(known_name)
    };
    let addr_for_upsert = addr.clone();
    wasm_bindgen_futures::spawn_local(async move {
        if let Err(e) =
            remote_store::upsert_remote(&addr_for_upsert, pre_name.as_deref(), true).await
        {
            web_sys::console::warn_1(&format!("rathole: upsert remote: {e}").into());
        }
    });

    let tx = action_tx.clone();
    let hello_addr = addr.clone();
    wasm_bindgen_futures::spawn_local(async move {
        match transport.fetch_hello().await {
            Ok((name, version, description)) => {
                if let Some(n) = name.as_deref().filter(|s| !s.trim().is_empty()) {
                    let _ = remote_store::upsert_remote(&hello_addr, Some(n), true).await;
                }
                let _ = tx.unbounded_send(AppAction::RemoteHello {
                    peer_addr: hello_addr,
                    name,
                    version,
                    description,
                });
            }
            Err(e) => {
                web_sys::console::warn_1(&format!("rathole: hello fetch failed: {e}").into());
            }
        }
    });
}

fn on_peer_input_key(
    app: &mut App,
    code: KeyCode,
    node: &Rc<MiddenNode>,
    action_tx: &mpsc::UnboundedSender<AppAction>,
) {
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
            // drop the &mut borrow of ephemeral before calling
            // `connect_to_peer`, which takes `&mut App`.
            let _ = eph;
            connect_to_peer(app, node, action_tx, addr, String::new());
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
        KeyCode::Esc => eph.focus = Focus::AdminPalette,
        KeyCode::Tab => {
            crate::ratcore::player_row_keys::enter(&mut app.state);
        }
        KeyCode::Up | KeyCode::Char('k') => {
            if has_rows {
                if shift {
                    eph.last_dispatch_scroll = eph.last_dispatch_scroll.saturating_sub(step);
                } else if let Some(ld) = eph.last_dispatch.as_mut() {
                    ld.cursor = ld.cursor.saturating_sub(step as usize);
                    eph.last_dispatch_scroll = 0;
                }
            } else {
                eph.last_dispatch_scroll = eph.last_dispatch_scroll.saturating_sub(step);
            }
        }
        KeyCode::Down | KeyCode::Char('j') => {
            if has_rows {
                if shift {
                    eph.last_dispatch_scroll = eph.last_dispatch_scroll.saturating_add(step);
                } else if let Some(ld) = eph.last_dispatch.as_mut() {
                    let max = ld.rows.len().saturating_sub(1);
                    ld.cursor = (ld.cursor + step as usize).min(max);
                    eph.last_dispatch_scroll = 0;
                }
            } else {
                eph.last_dispatch_scroll = eph.last_dispatch_scroll.saturating_add(step);
            }
        }
        KeyCode::Enter | KeyCode::Char('a') => {
            if let Some(ld) = eph.last_dispatch.as_ref() {
                if let Some(row) = ld.rows.get(ld.cursor) {
                    // /help rows: route enter through the slash repl
                    // instead of the action menu. row.id carries
                    // either the bare command name ("play") or a
                    // group + sub pair ("knock list"); seed the repl
                    // with `/<id> ` and switch focus so the user can
                    // either hit enter immediately to dispatch (for
                    // self-contained commands) or keep typing args.
                    if ld.command == "help" {
                        let id = row.get("id").and_then(|v| v.as_str()).unwrap_or("");
                        if !id.is_empty() {
                            let seed = format!("/{id} ");
                            crate::ratcore::repl_keys::enter_with_seed(&mut app.state, &seed);
                        }
                        return;
                    }
                    let actions =
                        crate::ratcore::catalog::result_actions_for_row(&ld.command, Some(row));
                    // single "view full row" action — skip the menu
                    // and render the json detail inline.
                    if actions.len() == 1 && actions[0].target_command == "__view_row__" {
                        let pretty =
                            serde_json::to_string_pretty(row).unwrap_or_else(|_| row.to_string());
                        eph.last_dispatch = Some(crate::ratcore::app::LastDispatch {
                            command: "(view row)".to_string(),
                            success: true,
                            message: "row detail".to_string(),
                            data_pretty: Some(pretty),
                            rows: vec![],
                            cursor: 0,
                        });
                        eph.last_dispatch_scroll = 0;
                        return;
                    }
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
        // PgUp/PgDn scroll the form body when content overflows.
        KeyCode::PageUp => {
            form.scroll = form.scroll.saturating_sub(5);
        }
        KeyCode::PageDown => {
            form.scroll = form.scroll.saturating_add(5);
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
                (FieldState::LongText { buf, cursor }, KeyCode::Delete) => ti::delete(buf, cursor),
                (FieldState::LongText { cursor, .. }, KeyCode::Left) => ti::move_left(cursor),
                (FieldState::LongText { buf, cursor }, KeyCode::Right) => {
                    ti::move_right(buf, cursor)
                }
                (FieldState::LongText { cursor, .. }, KeyCode::Home) => ti::move_home(cursor),
                (FieldState::LongText { buf, cursor }, KeyCode::End) => ti::move_end(buf, cursor),
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
fn on_action_menu_key(app: &mut App, code: KeyCode, tx: &mpsc::UnboundedSender<AppAction>) {
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
            if opt.target_command == "__view_row__" {
                let pretty = serde_json::to_string_pretty(&row).unwrap_or_else(|_| row.to_string());
                eph.last_dispatch = Some(crate::ratcore::app::LastDispatch {
                    command: format!("(view row)"),
                    success: true,
                    message: "row detail".to_string(),
                    data_pretty: Some(pretty),
                    rows: vec![],
                    cursor: 0,
                });
                eph.last_dispatch_scroll = 0;
                eph.focus = Focus::ResultPanel;
                return;
            }
            if opt.target_command == "__play_playlist__" || opt.target_command == "__play_album__" {
                let kind = if opt.target_command == "__play_playlist__" {
                    "playlist"
                } else {
                    "album"
                };
                let (id, title, _) = crate::ratcore::catalog::row_id_and_title(&row);
                let Some(id) = id else {
                    eph.focus = Focus::ResultPanel;
                    return;
                };
                let title = title.unwrap_or_else(|| kind.to_string());
                eph.focus = Focus::PlayerRow;
                play_collection_web(app, kind, id, title, tx);
                return;
            }
            if opt.target_command == "__enqueue_playlist__"
                || opt.target_command == "__enqueue_album__"
            {
                let kind = if opt.target_command == "__enqueue_playlist__" {
                    "playlist"
                } else {
                    "album"
                };
                let (id, title, _) = crate::ratcore::catalog::row_id_and_title(&row);
                let Some(id) = id else {
                    eph.focus = Focus::ResultPanel;
                    return;
                };
                let title = title.unwrap_or_else(|| kind.to_string());
                eph.focus = Focus::ResultPanel;
                enqueue_collection_web(app, kind, id, title, tx);
                return;
            }
            if opt.target_command == "__enqueue_song__" {
                let (_, title, _) = crate::ratcore::catalog::row_id_and_title(&row);
                let title = title.unwrap_or_default();
                eph.focus = Focus::ResultPanel;
                enqueue_song_by_title_web(app, title, tx);
                return;
            }
            if opt.target_command == "__goto_album__" || opt.target_command == "__goto_artist__" {
                let (album_id, artist_id) = crate::ratcore::catalog::row_album_and_artist(&row);
                eph.focus = Focus::ResultPanel;
                let want_album = opt.target_command == "__goto_album__";
                let direct = if want_album {
                    album_id.clone()
                } else {
                    artist_id.clone()
                };
                if let Some(id) = direct.filter(|s| !s.is_empty()) {
                    let (kind, parent_field) = if want_album {
                        ("song", "album_id")
                    } else {
                        ("album", "artist_id")
                    };
                    fire_library_by_id_web(app, kind, parent_field, id, tx);
                } else {
                    let row_kind = row
                        .get("type")
                        .and_then(|v| v.as_str())
                        .unwrap_or("song")
                        .to_string();
                    let row_id = crate::ratcore::catalog::row_id_and_title(&row).0;
                    if let Some(rid) = row_id {
                        resolve_then_goto_web(app, row_kind, rid, want_album, tx);
                    } else {
                        let label = if want_album { "album" } else { "artist" };
                        app.state.ephemeral.repl.status =
                            Some(ReplStatus::err(format!("no {label} id on this row")));
                    }
                }
                return;
            }
            if opt.target_command.starts_with("__queue_") {
                let position = row
                    .get("position")
                    .and_then(|v| v.as_u64())
                    .map(|n| n as usize);
                handle_queue_action_web(app, &opt.target_command, position, tx);
                return;
            }
            // play single song row by re-searching the title and
            // auto-playing the top result.
            if opt.target_command == "__play_song__" {
                let (_, title, _) = crate::ratcore::catalog::row_id_and_title(&row);
                let title = title.unwrap_or_default();
                eph.focus = Focus::MusicView;
                eph.music.mode = crate::ratcore::app::MusicMode::Results;
                eph.music.query = title.clone();
                eph.music.query_cursor = title.chars().count();
                eph.music.auto_play_on_results = true;
                fire_search_web(app, tx);
                return;
            }
            // toggle favorite — sentinel encodes the kind.
            if let Some(kind) = opt
                .target_command
                .strip_prefix("__toggle_favorite_")
                .and_then(|s| s.strip_suffix("__"))
            {
                let (id, _, _) = crate::ratcore::catalog::row_id_and_title(&row);
                eph.focus = Focus::ResultPanel;
                if let Some(id) = id {
                    let _ = tx.unbounded_send(AppAction::ToggleFavorite {
                        target_type: kind.to_string(),
                        target_id: id,
                    });
                }
                return;
            }
            // add song / album to a playlist via the form.
            if opt.target_command == "__add_to_playlist__"
                || opt.target_command == "__add_album_to_playlist__"
            {
                let (id, _, _) = crate::ratcore::catalog::row_id_and_title(&row);
                let Some(target_id) = id else {
                    eph.focus = Focus::ResultPanel;
                    return;
                };
                let mut prefill = serde_json::Map::new();
                if opt.target_command == "__add_to_playlist__" {
                    prefill.insert(
                        "song_ids".to_string(),
                        serde_json::Value::Array(vec![serde_json::Value::String(target_id)]),
                    );
                } else {
                    prefill.insert("album_id".to_string(), serde_json::Value::String(target_id));
                }
                let prefill = serde_json::Value::Object(prefill);
                let Some(cmd) = app
                    .commands
                    .iter()
                    .find(|c| c.name == "add_songs_to_playlist")
                    .cloned()
                else {
                    eph.focus = Focus::ResultPanel;
                    return;
                };
                app.state.ephemeral.form = Some(
                    crate::ratcore::app::CommandForm::new_with_prefill(&cmd, &prefill),
                );
                app.state.ephemeral.focus = Focus::CommandForm;
                maybe_fetch_select_options(app, tx);
                return;
            }
            let Some(cmd) = app
                .commands
                .iter()
                .find(|c| c.name == opt.target_command)
                .cloned()
            else {
                eph.focus = Focus::ResultPanel;
                return;
            };
            app.state.ephemeral.form = Some(crate::ratcore::app::CommandForm::new_with_prefill(
                &cmd, &row,
            ));
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
            if let Some(FieldState::SelectFrom { error, .. }) = form.fields.get_mut(field_idx) {
                *error = Some(msg);
            }
            return;
        }
    };
    if let Some(FieldState::SelectFrom { loading, error, .. }) = form.fields.get_mut(field_idx) {
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

fn on_action(app: &mut App, action: AppAction, action_tx: &mpsc::UnboundedSender<AppAction>) {
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
        AppAction::RemoteHello {
            peer_addr,
            name,
            version: _,
            description: _,
        } => {
            // ignore stale replies: only update if the connected peer
            // hasn't moved on to another remote.
            if app
                .state
                .ephemeral
                .connected_peer
                .as_deref()
                .map(|p| p == peer_addr)
                .unwrap_or(false)
            {
                app.state.ephemeral.remote_name = name.filter(|s| !s.trim().is_empty());
            }
        }
        AppAction::RemotesLoaded { remotes } => {
            let len = remotes.len();
            app.state.ephemeral.remotes_view = remotes;
            // clamp the cursor in case the previous selection went away.
            let cur = app.state.ephemeral.remotes_view_cursor;
            app.state.ephemeral.remotes_view_cursor = if len == 0 { 0 } else { cur.min(len - 1) };
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
        // music view is browse-only on web today (no rodio in wasm).
        // search results would arrive via a public-route fetch in a
        // future change; just no-op for now.
        AppAction::MusicSearchResults { query, result } => {
            let m = &mut app.state.ephemeral.music;
            if m.query.trim() != query.trim() {
                return;
            }
            m.searching = false;
            match result {
                Ok(rows) => {
                    m.results = rows;
                    m.results_cursor = 0;
                    m.search_error = None;
                    if !m.results.is_empty() {
                        m.mode = crate::ratcore::app::MusicMode::Results;
                    }
                    // consume the auto-play flag set by `/play <query>`.
                    if m.auto_play_on_results && !m.results.is_empty() {
                        m.auto_play_on_results = false;
                        play_one_at_cursor_web(app, action_tx);
                        let title = app
                            .state
                            .ephemeral
                            .music
                            .results
                            .first()
                            .map(|s| s.title.clone())
                            .unwrap_or_default();
                        app.state.ephemeral.repl.status = Some(
                            crate::ratcore::app::ReplStatus::ok(format!("playing: {title}")),
                        );
                    } else {
                        m.auto_play_on_results = false;
                    }
                }
                Err(e) => {
                    m.auto_play_on_results = false;
                    m.search_error = Some(e.clone());
                    app.state.ephemeral.repl.status = Some(crate::ratcore::app::ReplStatus::err(
                        format!("search failed: {e}"),
                    ));
                }
            }
        }
        AppAction::MusicEvent(ev) => {
            // mirror the tty: when the playing track changes, refresh
            // its favorited-status by asking the transport.
            let track_changed = matches!(ev, crate::ratcore::app::MusicEvent::TrackChanged { .. });
            apply_music_event_web(app, ev, action_tx);
            if track_changed {
                if let Some(cur) = app.state.ephemeral.music.currently_playing() {
                    let id = cur.id.clone();
                    let transport = app.transport.clone();
                    let tx = action_tx.clone();
                    wasm_bindgen_futures::spawn_local(async move {
                        let result = transport.is_favorited("song", &id).await;
                        let _ = tx.unbounded_send(AppAction::FavoriteResult {
                            target_type: "song".into(),
                            target_id: id,
                            result,
                            silent: true,
                        });
                    });
                } else {
                    app.state.ephemeral.music.current_favorited = false;
                }
            }
        }
        AppAction::ToggleFavorite {
            target_type,
            target_id,
        } => {
            let transport = app.transport.clone();
            let tx = action_tx.clone();
            let tt = target_type.clone();
            let tid = target_id.clone();
            wasm_bindgen_futures::spawn_local(async move {
                let result = transport.toggle_favorite(&tt, &tid).await;
                let _ = tx.unbounded_send(AppAction::FavoriteResult {
                    target_type: tt,
                    target_id: tid,
                    result,
                    silent: false,
                });
            });
        }
        AppAction::FavoriteResult {
            target_type,
            target_id,
            result,
            silent,
        } => match result {
            Ok(now_favorited) => {
                if target_type == "song" {
                    if let Some(cur) = app.state.ephemeral.music.currently_playing() {
                        if cur.id == target_id {
                            app.state.ephemeral.music.current_favorited = now_favorited;
                        }
                    }
                }
                if !silent {
                    app.state.ephemeral.repl.status =
                        Some(crate::ratcore::app::ReplStatus::ok(if now_favorited {
                            "favorited"
                        } else {
                            "unfavorited"
                        }));
                }
            }
            Err(e) => {
                if !silent {
                    app.state.ephemeral.repl.status = Some(crate::ratcore::app::ReplStatus::err(
                        format!("favorite failed: {e}"),
                    ));
                }
            }
        },
        AppAction::CollectionLoaded { songs } => {
            // promote the loaded collection into the queue + start
            // playing the first row. blob resolution is lazy (per
            // `play_index_web`) so a 200-row album doesn't pre-fetch
            // 200 urls.
            if !songs.is_empty() {
                play_now_web(app, songs, 0, action_tx);
            }
        }
        AppAction::CollectionEnqueued { songs } => {
            let n = songs.len();
            enqueue_now_web(app, songs, action_tx);
            app.state.ephemeral.repl.status = Some(ReplStatus::ok(format!(
                "queued {n} track{}",
                if n == 1 { "" } else { "s" }
            )));
        }
    }
}

/// minimal music-view key handler for the web shell. supports the
/// search box + browse mode but no playback (no rodio in wasm).
fn on_music_key_web(app: &mut App, code: KeyCode, action_tx: &mpsc::UnboundedSender<AppAction>) {
    use crate::ratcore::app::MusicMode;
    use crate::ratcore::text_input as ti;
    if matches!(code, KeyCode::Esc) {
        app.state.ephemeral.focus = Focus::Landing;
        return;
    }
    let mode = app.state.ephemeral.music.mode;
    match (mode, code) {
        (MusicMode::Search, KeyCode::Tab | KeyCode::Down) => {
            if !app.state.ephemeral.music.results.is_empty() {
                app.state.ephemeral.music.mode = MusicMode::Results;
            }
        }
        (MusicMode::Search, KeyCode::Backspace) => {
            let m = &mut app.state.ephemeral.music;
            ti::backspace(&mut m.query, &mut m.query_cursor);
        }
        (MusicMode::Search, KeyCode::Delete) => {
            let m = &mut app.state.ephemeral.music;
            ti::delete(&mut m.query, &mut m.query_cursor);
        }
        (MusicMode::Search, KeyCode::Left) => {
            let m = &mut app.state.ephemeral.music;
            ti::move_left(&mut m.query_cursor);
        }
        (MusicMode::Search, KeyCode::Right) => {
            let m = &mut app.state.ephemeral.music;
            ti::move_right(&m.query, &mut m.query_cursor);
        }
        (MusicMode::Search, KeyCode::Char(c)) => {
            if !c.is_control() {
                let m = &mut app.state.ephemeral.music;
                ti::insert_char(&mut m.query, &mut m.query_cursor, c);
            }
        }
        (MusicMode::Search, KeyCode::Enter) => fire_search_web(app, action_tx),
        (MusicMode::Results, KeyCode::Enter) => play_one_at_cursor_web(app, action_tx),
        (MusicMode::Results, KeyCode::Char('A')) => play_from_cursor_web(app, action_tx),
        (MusicMode::Results, KeyCode::Char('/') | KeyCode::Tab) => {
            app.state.ephemeral.music.mode = MusicMode::Results;
        }
        (MusicMode::Results, KeyCode::Char('j') | KeyCode::Down) => {
            let m = &mut app.state.ephemeral.music;
            if !m.results.is_empty() {
                m.results_cursor = (m.results_cursor + 1).min(m.results.len() - 1);
            }
        }
        (MusicMode::Results, KeyCode::Char('k') | KeyCode::Up) => {
            let m = &mut app.state.ephemeral.music;
            m.results_cursor = m.results_cursor.saturating_sub(1);
        }
        _ => {}
    }
}

/// fire the music search query against the transport and stash the
/// results back on `app.state.ephemeral.music`. mirrors the tty's
/// `fire_search` helper.
fn fire_search_web(app: &mut App, action_tx: &mpsc::UnboundedSender<AppAction>) {
    let q = app.state.ephemeral.music.query.trim().to_string();
    if q.is_empty() {
        app.state.ephemeral.music.search_error = Some("query is empty".to_string());
        return;
    }
    app.state.ephemeral.music.searching = true;
    app.state.ephemeral.music.search_error = None;
    let transport = app.transport.clone();
    let tx = action_tx.clone();
    let q_for_task = q.clone();
    wasm_bindgen_futures::spawn_local(async move {
        let result = transport.search_songs(&q_for_task, 100).await;
        let _ = tx.unbounded_send(AppAction::MusicSearchResults {
            query: q_for_task,
            result,
        });
    });
}

// =========================================================================
// queue manager (web) — mirrors the tty-side queue manager. rathole
// owns m.queue + m.current; the html-audio backend is treated as a
// single-track player, so every track switch is a fresh
// `PlayerCmd::Load(vec![url])` for the row at `m.current`. queue
// edits (remove/move/clear) are pure rathole state mutations.
// =========================================================================

/// load and play the row at `m.queue[idx]` in the web shell.
/// resolves the row's blob to an object url and sends a single-
/// element `PlayerCmd::Load`. on resolve failure, emits an Error
/// event followed by Ended so the auto-advance handler skips past
/// broken rows.
fn play_index_web(app: &mut App, idx: usize, action_tx: &mpsc::UnboundedSender<AppAction>) {
    let m = &mut app.state.ephemeral.music;
    if idx >= m.queue.len() {
        m.current = None;
        m.position_ms = 0;
        m.duration_ms = 0;
        m.player_state = crate::ratcore::app::PlayerState::Stopped;
        return;
    }
    m.current = Some(idx);
    m.position_ms = 0;
    m.duration_ms = 0;
    m.player_state = crate::ratcore::app::PlayerState::Loading;
    let row = m.queue[idx].clone();
    let Some(blob_id) = row.media_blob_id.clone() else {
        let _ = action_tx.unbounded_send(AppAction::MusicEvent(
            crate::ratcore::app::MusicEvent::Error(format!(
                "no playable blob for {} (skipping)",
                row.title
            )),
        ));
        let _ = action_tx.unbounded_send(AppAction::MusicEvent(
            crate::ratcore::app::MusicEvent::Ended,
        ));
        return;
    };
    let Some(player) = app.player.clone() else {
        m.last_event_error = Some("no audio backend in this shell".to_string());
        return;
    };
    let transport = app.transport.clone();
    let tx = action_tx.clone();
    let title = row.title.clone();
    wasm_bindgen_futures::spawn_local(async move {
        match transport.resolve_blob_url(&blob_id).await {
            Ok((url, _mime)) => {
                if let Err(e) = player
                    .send(crate::ratcore::transport::PlayerCmd::Load(vec![url]))
                    .await
                {
                    let _ = tx.unbounded_send(AppAction::MusicEvent(
                        crate::ratcore::app::MusicEvent::Error(format!("player send failed: {e}")),
                    ));
                }
            }
            Err(e) => {
                let _ = tx.unbounded_send(AppAction::MusicEvent(
                    crate::ratcore::app::MusicEvent::Error(format!(
                        "resolve blob url failed for {title}: {e}"
                    )),
                ));
                let _ = tx.unbounded_send(AppAction::MusicEvent(
                    crate::ratcore::app::MusicEvent::Ended,
                ));
            }
        }
    });
}

/// advance to the next track in the local queue.
fn play_next_web(app: &mut App, action_tx: &mpsc::UnboundedSender<AppAction>) {
    let next = app
        .state
        .ephemeral
        .music
        .current
        .map(|c| c + 1)
        .unwrap_or(0);
    play_index_web(app, next, action_tx);
}

/// step back one track in the local queue.
fn play_previous_web(app: &mut App, action_tx: &mpsc::UnboundedSender<AppAction>) {
    let prev = app
        .state
        .ephemeral
        .music
        .current
        .map(|c| c.saturating_sub(1))
        .unwrap_or(0);
    play_index_web(app, prev, action_tx);
}

/// replace the queue with `songs` and start playing from `start`.
fn play_now_web(
    app: &mut App,
    songs: Vec<crate::ratcore::app::SongRow>,
    start: usize,
    action_tx: &mpsc::UnboundedSender<AppAction>,
) {
    app.state.ephemeral.music.queue = songs;
    play_index_web(app, start, action_tx);
}

/// append `songs` to the end of the queue. starts playback if
/// nothing is currently loaded.
fn enqueue_now_web(
    app: &mut App,
    songs: Vec<crate::ratcore::app::SongRow>,
    action_tx: &mpsc::UnboundedSender<AppAction>,
) {
    if songs.is_empty() {
        return;
    }
    let m = &mut app.state.ephemeral.music;
    let was_idle = m.current.is_none();
    let start = m.queue.len();
    m.queue.extend(songs);
    if was_idle {
        play_index_web(app, start, action_tx);
    }
}

/// play just the row under the cursor in the web shell. queue is
/// replaced with a single-element vec.
fn play_one_at_cursor_web(app: &mut App, action_tx: &mpsc::UnboundedSender<AppAction>) {
    let m = &app.state.ephemeral.music;
    if m.results.is_empty() {
        return;
    }
    let idx = m.results_cursor.min(m.results.len() - 1);
    let row = m.results[idx].clone();
    play_now_web(app, vec![row], 0, action_tx);
}

/// load the music view's results into the player queue starting at
/// the cursor position. plays from `start`; remaining tracks resolve
/// lazily on auto-advance.
fn play_from_cursor_web(app: &mut App, action_tx: &mpsc::UnboundedSender<AppAction>) {
    let m = &app.state.ephemeral.music;
    if m.results.is_empty() {
        return;
    }
    let start = m.results_cursor.min(m.results.len() - 1);
    let queue: Vec<crate::ratcore::app::SongRow> = m.results[start..].to_vec();
    play_now_web(app, queue, 0, action_tx);
}

/// fetch playlist or album songs via transport, then replace the
/// queue and start playing. blob resolution happens lazily per-track
/// via `play_index_web`.
fn play_collection_web(
    app: &mut App,
    kind: &'static str,
    id: String,
    title: String,
    action_tx: &mpsc::UnboundedSender<AppAction>,
) {
    app.state.ephemeral.repl.status = Some(crate::ratcore::app::ReplStatus::info(format!(
        "loading {kind} {title}\u{2026}"
    )));
    let m = &mut app.state.ephemeral.music;
    m.queue.clear();
    m.current = None;
    m.position_ms = 0;
    m.duration_ms = 0;
    m.queue_resolving = 0;

    if app.player.is_none() {
        m.last_event_error = Some("no audio backend in this shell".to_string());
        return;
    }
    let transport = app.transport.clone();
    let tx = action_tx.clone();
    let title_for_event = title.clone();
    wasm_bindgen_futures::spawn_local(async move {
        let songs_result = match kind {
            "playlist" => transport.playlist_songs(&id).await,
            "album" => transport.album_songs(&id).await,
            other => Err(format!("unknown collection kind: {other}")),
        };
        let songs = match songs_result {
            Ok(s) => s,
            Err(e) => {
                let _ = tx.unbounded_send(AppAction::MusicEvent(
                    crate::ratcore::app::MusicEvent::Error(format!("load {kind} failed: {e}")),
                ));
                return;
            }
        };
        if songs.is_empty() {
            let _ = tx.unbounded_send(AppAction::MusicEvent(
                crate::ratcore::app::MusicEvent::Error(format!(
                    "{kind} {title_for_event} is empty"
                )),
            ));
            return;
        }
        let _ = tx.unbounded_send(AppAction::CollectionLoaded { songs });
    });
}

/// fetch playlist or album songs and append them to the existing
/// queue without interrupting the currently-playing track. queue
/// extension is rathole-side; the audio thread is unaffected.
fn enqueue_collection_web(
    app: &mut App,
    kind: &'static str,
    id: String,
    title: String,
    action_tx: &mpsc::UnboundedSender<AppAction>,
) {
    app.state.ephemeral.repl.status = Some(crate::ratcore::app::ReplStatus::info(format!(
        "queueing {kind} {title}\u{2026}"
    )));
    let transport = app.transport.clone();
    let tx = action_tx.clone();
    let title_for_event = title.clone();
    wasm_bindgen_futures::spawn_local(async move {
        let songs_result = match kind {
            "playlist" => transport.playlist_songs(&id).await,
            "album" => transport.album_songs(&id).await,
            other => Err(format!("unknown collection kind: {other}")),
        };
        let songs = match songs_result {
            Ok(s) => s,
            Err(e) => {
                let _ = tx.unbounded_send(AppAction::MusicEvent(
                    crate::ratcore::app::MusicEvent::Error(format!("queue {kind} failed: {e}")),
                ));
                return;
            }
        };
        if songs.is_empty() {
            let _ = tx.unbounded_send(AppAction::MusicEvent(
                crate::ratcore::app::MusicEvent::Error(format!(
                    "{kind} {title_for_event} is empty"
                )),
            ));
            return;
        }
        let _ = tx.unbounded_send(AppAction::CollectionEnqueued { songs });
    });
}

/// resolve a single song row by title via the search index and
/// enqueue it. mirrors the tty `enqueue_song_by_title` helper.
fn enqueue_song_by_title_web(
    app: &mut App,
    title: String,
    action_tx: &mpsc::UnboundedSender<AppAction>,
) {
    if title.is_empty() {
        return;
    }
    app.state.ephemeral.repl.status = Some(crate::ratcore::app::ReplStatus::info(format!(
        "queueing {title}\u{2026}"
    )));
    let transport = app.transport.clone();
    let tx = action_tx.clone();
    wasm_bindgen_futures::spawn_local(async move {
        let songs = match transport.search_songs(&title, 1).await {
            Ok(rows) => rows,
            Err(e) => {
                let _ = tx.unbounded_send(AppAction::MusicEvent(
                    crate::ratcore::app::MusicEvent::Error(format!("queue search failed: {e}")),
                ));
                return;
            }
        };
        let Some(song) = songs.into_iter().next() else {
            let _ = tx.unbounded_send(AppAction::MusicEvent(
                crate::ratcore::app::MusicEvent::Error(format!("no match for {title}")),
            ));
            return;
        };
        let _ = tx.unbounded_send(AppAction::CollectionEnqueued { songs: vec![song] });
    });
}

/// fire a library_query and route the result through
/// `AdminDispatchResult` so the result panel renders it. mirrors the
/// tty `fire_library_query` helper.
#[allow(dead_code)]
fn fire_library_query_web(
    app: &App,
    kind: &'static str,
    query: Option<String>,
    action_tx: &mpsc::UnboundedSender<AppAction>,
) {
    let label = match kind {
        "favorites" => "library_favorites".to_string(),
        "radio" => "radio_stations_list".to_string(),
        _ => format!("library_{kind}"),
    };
    let transport = app.transport.clone();
    let tx = action_tx.clone();
    wasm_bindgen_futures::spawn_local(async move {
        let response = transport.library_query(kind, query.as_deref()).await;
        let _ = tx.unbounded_send(AppAction::AdminDispatchResult {
            command: label,
            response,
        });
    });
}

fn fire_library_by_id_web(
    app: &App,
    kind: &'static str,
    parent_field: &'static str,
    parent_id: String,
    action_tx: &mpsc::UnboundedSender<AppAction>,
) {
    let label = format!("library_{kind}_by_{parent_field}");
    let transport = app.transport.clone();
    let tx = action_tx.clone();
    wasm_bindgen_futures::spawn_local(async move {
        let response = transport
            .library_by_id(kind, parent_field, &parent_id)
            .await;
        let _ = tx.unbounded_send(AppAction::AdminDispatchResult {
            command: label,
            response,
        });
    });
}

fn resolve_then_goto_web(
    app: &App,
    row_kind: String,
    row_id: String,
    want_album: bool,
    action_tx: &mpsc::UnboundedSender<AppAction>,
) {
    let transport = app.transport.clone();
    let tx = action_tx.clone();
    wasm_bindgen_futures::spawn_local(async move {
        match transport.resolve_parent_ids(&row_kind, &row_id).await {
            Ok((album_id, artist_id)) => {
                let (kind, parent_field, pid) = if want_album {
                    ("song", "album_id", album_id)
                } else {
                    ("album", "artist_id", artist_id)
                };
                let Some(pid) = pid.filter(|s| !s.is_empty()) else {
                    let label = if want_album { "album" } else { "artist" };
                    let _ = tx.unbounded_send(AppAction::AdminDispatchResult {
                        command: format!("library_{kind}_by_{parent_field}"),
                        response: DispatchResponse {
                            success: false,
                            message: format!("no {label} for this row"),
                            data: None,
                        },
                    });
                    return;
                };
                let label = format!("library_{kind}_by_{parent_field}");
                let response = transport.library_by_id(kind, parent_field, &pid).await;
                let _ = tx.unbounded_send(AppAction::AdminDispatchResult {
                    command: label,
                    response,
                });
            }
            Err(msg) => {
                let _ = tx.unbounded_send(AppAction::AdminDispatchResult {
                    command: "resolve_parent_ids".to_string(),
                    response: DispatchResponse {
                        success: false,
                        message: msg,
                        data: None,
                    },
                });
            }
        }
    });
}

/// handle `__queue_*` sentinel actions in the web shell. queue
/// mutations rebuild the player by stopping + re-enqueueing the
/// remaining tracks (which briefly interrupts playback).
fn handle_queue_action_web(
    app: &mut App,
    sentinel: &str,
    position: Option<usize>,
    action_tx: &mpsc::UnboundedSender<AppAction>,
) {
    use crate::ratcore::transport::PlayerCmd;
    let m = &mut app.state.ephemeral.music;
    let len = m.queue.len();
    if sentinel == "__queue_clear__" {
        send_player_web(app, PlayerCmd::Stop);
        let m = &mut app.state.ephemeral.music;
        m.queue.clear();
        m.current = None;
        m.queue_resolving = 0;
        m.position_ms = 0;
        m.duration_ms = 0;
        app.state.ephemeral.last_dispatch = None;
        app.state.ephemeral.repl.status = Some(ReplStatus::ok("queue cleared"));
        return;
    }
    let Some(pos) = position else {
        return;
    };
    if pos >= len {
        return;
    }
    match sentinel {
        "__queue_jump__" => {
            requeue_from_web(app, pos, action_tx);
        }
        "__queue_remove__" => {
            let m = &mut app.state.ephemeral.music;
            let was_current = m.current == Some(pos);
            m.queue.remove(pos);
            if let Some(c) = m.current {
                if pos < c {
                    m.current = Some(c - 1);
                } else if pos == c && c >= m.queue.len() {
                    m.current = if m.queue.is_empty() { None } else { Some(0) };
                }
            }
            if app.state.ephemeral.music.queue.is_empty() {
                send_player_web(app, PlayerCmd::Stop);
                app.state.ephemeral.repl.status = Some(ReplStatus::ok("queue cleared"));
            } else {
                let start = app.state.ephemeral.music.current.unwrap_or(0);
                if was_current {
                    requeue_from_web(app, start, action_tx);
                }
                rerender_queue_web(app);
            }
        }
        "__queue_move_up__" => {
            if pos == 0 {
                return;
            }
            let m = &mut app.state.ephemeral.music;
            m.queue.swap(pos, pos - 1);
            if let Some(c) = m.current.as_mut() {
                if *c == pos {
                    *c -= 1;
                } else if *c == pos - 1 {
                    *c += 1;
                }
            }
            rerender_queue_web(app);
        }
        "__queue_move_down__" => {
            if pos + 1 >= len {
                return;
            }
            let m = &mut app.state.ephemeral.music;
            m.queue.swap(pos, pos + 1);
            if let Some(c) = m.current.as_mut() {
                if *c == pos {
                    *c += 1;
                } else if *c == pos + 1 {
                    *c -= 1;
                }
            }
            rerender_queue_web(app);
        }
        _ => {}
    }
}

fn rerender_queue_web(app: &mut App) {
    let cur = app
        .state
        .ephemeral
        .last_dispatch
        .as_ref()
        .map(|ld| ld.cursor)
        .unwrap_or(0);
    crate::ratcore::repl_keys::render_queue_panel(&mut app.state, Some(cur));
}

/// rebuild + restart playback at queue index `start`. queue
/// contents are preserved.
fn requeue_from_web(app: &mut App, start: usize, action_tx: &mpsc::UnboundedSender<AppAction>) {
    play_index_web(app, start, action_tx);
}
/// a player or transport (`/play`, `/search`, `/pause`, `/next`,
/// etc.) are no-ops here — when the html-audio runtime lands they
/// can be wired in. focus changes (`/admin`, `/music`), `/quit` and
/// the editing keys all work today.
fn on_repl_key_web(app: &mut App, code: KeyCode, action_tx: &mpsc::UnboundedSender<AppAction>) {
    use crate::ratcore::app::ReplStatus;
    use crate::ratcore::repl_keys as rk;
    match code {
        KeyCode::Esc => rk::handle_escape(&mut app.state),
        KeyCode::Enter => {
            let line = app.state.ephemeral.repl.input.trim().to_string();
            let action = crate::ratcore::slash::parse(&line);
            let mut exit = false;
            let outcome = rk::apply_navigation(&mut app.state, &mut exit, &line, action);
            if exit {
                app.exit = true;
                return;
            }
            if let rk::ReplOutcome::Run(action) = outcome {
                use crate::ratcore::app::MusicMode;
                use crate::ratcore::slash::SlashAction;
                use crate::ratcore::transport::PlayerCmd;
                let mut handled = true;
                match action {
                    SlashAction::Play { query: None } => {
                        send_player_web(app, PlayerCmd::Play);
                        app.state.ephemeral.repl.status = Some(ReplStatus::ok("play"));
                    }
                    SlashAction::Play { query: Some(q) } => {
                        // mirror tty: jump to MusicView, set query,
                        // arm auto-play, kick off the search. when
                        // results land MusicSearchResults will queue
                        // them all and start the player.
                        app.state.ephemeral.repl.clear_input();
                        rk::leave(&mut app.state);
                        app.state.ephemeral.focus = Focus::MusicView;
                        app.state.ephemeral.music.mode = MusicMode::Results;
                        app.state.ephemeral.music.query = q;
                        app.state.ephemeral.music.query_cursor =
                            app.state.ephemeral.music.query.chars().count();
                        app.state.ephemeral.music.auto_play_on_results = true;
                        fire_search_web(app, action_tx);
                        app.state.ephemeral.repl.status =
                            Some(ReplStatus::info("searching\u{2026}"));
                    }
                    SlashAction::Pause => {
                        send_player_web(app, PlayerCmd::Pause);
                        app.state.ephemeral.repl.status = Some(ReplStatus::ok("pause"));
                    }
                    SlashAction::Stop => {
                        send_player_web(app, PlayerCmd::Stop);
                        app.state.ephemeral.repl.status = Some(ReplStatus::ok("stop"));
                    }
                    SlashAction::ClearQueue => {
                        send_player_web(app, PlayerCmd::Stop);
                        let m = &mut app.state.ephemeral.music;
                        m.queue.clear();
                        m.current = None;
                        m.queue_resolving = 0;
                        m.position_ms = 0;
                        m.duration_ms = 0;
                        app.state.ephemeral.repl.status = Some(ReplStatus::ok("queue cleared"));
                    }
                    SlashAction::Next => {
                        play_next_web(app, action_tx);
                        app.state.ephemeral.repl.status = Some(ReplStatus::ok("next"));
                    }
                    SlashAction::Previous => {
                        play_previous_web(app, action_tx);
                        app.state.ephemeral.repl.status = Some(ReplStatus::ok("previous"));
                    }
                    SlashAction::Seek { seconds } => {
                        send_player_web(app, PlayerCmd::Seek((seconds as u64) * 1000));
                        app.state.ephemeral.repl.status =
                            Some(ReplStatus::ok(format!("seek {seconds}s")));
                    }
                    SlashAction::Volume { percent } => {
                        let v = ((percent as f32) / 100.0).clamp(0.0, 2.0);
                        app.state.ephemeral.music.volume = v;
                        send_player_web(app, PlayerCmd::SetVolume(v));
                        app.state.ephemeral.repl.status =
                            Some(ReplStatus::ok(format!("vol {percent}%")));
                    }
                    SlashAction::Search { query: None } => {
                        app.state.ephemeral.repl.clear_input();
                        rk::leave(&mut app.state);
                        app.state.ephemeral.focus = crate::ratcore::app::Focus::MusicView;
                        app.state.ephemeral.music.mode = MusicMode::Results;
                        app.state.ephemeral.repl.status =
                            Some(ReplStatus::info("type to search music"));
                    }
                    SlashAction::Search { query: Some(q) } => {
                        // FTS-ranked unified search via MiddenTransport.
                        // results land in the result panel like in tty.
                        app.state.ephemeral.repl.clear_input();
                        rk::leave(&mut app.state);
                        let transport = app.transport.clone();
                        let tx_clone = action_tx.clone();
                        let qc = q.clone();
                        wasm_bindgen_futures::spawn_local(async move {
                            let response = transport.unified_search(&qc).await;
                            let _ = tx_clone.unbounded_send(AppAction::AdminDispatchResult {
                                command: "search".to_string(),
                                response,
                            });
                        });
                        app.state.ephemeral.repl.status =
                            Some(ReplStatus::info(format!("searching {q}\u{2026}")));
                        app.state.ephemeral.focus = crate::ratcore::app::Focus::ResultPanel;
                    }
                    SlashAction::Library { kind, query } => {
                        let label = match kind {
                            "favorites" => "library_favorites".to_string(),
                            "radio" => "radio_stations_list".to_string(),
                            _ => format!("library_{kind}"),
                        };
                        let transport = app.transport.clone();
                        let tx_clone = action_tx.clone();
                        let q = query.clone();
                        wasm_bindgen_futures::spawn_local(async move {
                            let response = transport.library_query(kind, q.as_deref()).await;
                            // `/radio <name>` with a matching station
                            // starts that station instead of just listing.
                            if kind == "radio" && q.is_some() && response.success {
                                if let Some(station_id) = crate::ratcore::slash::match_station_id(
                                    &response.data,
                                    q.as_deref(),
                                ) {
                                    let start_resp = transport
                                        .admin_dispatch(
                                            "radio_supervisor_start",
                                            serde_json::json!({ "station_id": station_id }),
                                        )
                                        .await;
                                    let _ =
                                        tx_clone.unbounded_send(AppAction::AdminDispatchResult {
                                            command: "radio_supervisor_start".to_string(),
                                            response: start_resp,
                                        });
                                    return;
                                }
                            }
                            let _ = tx_clone.unbounded_send(AppAction::AdminDispatchResult {
                                command: label,
                                response,
                            });
                        });
                        app.state.ephemeral.repl.status =
                            Some(ReplStatus::info(format!("loading {kind}\u{2026}")));
                        app.state.ephemeral.focus = crate::ratcore::app::Focus::ResultPanel;
                    }
                    SlashAction::Local => {
                        app.state.ephemeral.focus = crate::ratcore::app::Focus::MusicView;
                        app.state.ephemeral.music.mode = crate::ratcore::app::MusicMode::Results;
                        app.state.ephemeral.music.searching = true;
                        app.state.ephemeral.music.search_error = None;
                        app.state.ephemeral.repl.status =
                            Some(ReplStatus::info("loading local songs\u{2026}".to_string()));
                        let transport = app.transport.clone();
                        let tx_clone = action_tx.clone();
                        wasm_bindgen_futures::spawn_local(async move {
                            let result = transport.list_local_songs(200).await;
                            let _ = tx_clone.unbounded_send(AppAction::MusicSearchResults {
                                query: String::new(),
                                result,
                            });
                        });
                    }
                    SlashAction::AdminDispatch { name, body } => {
                        // generic admin-rpc dispatch from /knock /users
                        // /analytics /radio subcommands.
                        let transport = app.transport.clone();
                        let tx_clone = action_tx.clone();
                        let name_owned = name.to_string();
                        wasm_bindgen_futures::spawn_local(async move {
                            let response = transport.admin_dispatch(&name_owned, body).await;
                            let _ = tx_clone.unbounded_send(AppAction::AdminDispatchResult {
                                command: name_owned,
                                response,
                            });
                        });
                        app.state.ephemeral.repl.status =
                            Some(ReplStatus::info(format!("dispatching {name}\u{2026}")));
                        app.state.ephemeral.focus = crate::ratcore::app::Focus::ResultPanel;
                    }
                    _ => {
                        handled = false;
                    }
                }
                if !handled {
                    // commands that need transport-side wiring not yet
                    // ported to the web shell (search via p2p, library
                    // queries, /play <query>, favorites). friendly hint
                    // until the spume music-runtime integration lands.
                    app.state.ephemeral.repl.status = Some(ReplStatus::err(
                        "this command needs the web music runtime (coming soon)".to_string(),
                    ));
                }
                app.state.ephemeral.repl.clear_input();
                rk::leave(&mut app.state);
            }
        }
        KeyCode::Tab => rk::handle_tab(&mut app.state),
        KeyCode::Up => {
            if !rk::flyout_up(&mut app.state) {
                rk::history_prev(&mut app.state);
            }
        }
        KeyCode::Down => {
            if !rk::flyout_down(&mut app.state) {
                rk::history_next(&mut app.state);
            }
        }
        KeyCode::Left => rk::move_left(&mut app.state),
        KeyCode::Right => rk::move_right(&mut app.state),
        KeyCode::Home => rk::move_home(&mut app.state),
        KeyCode::End => rk::move_end(&mut app.state),
        KeyCode::Backspace => rk::backspace(&mut app.state),
        KeyCode::Delete => rk::delete(&mut app.state),
        KeyCode::Char(c) if !c.is_control() => rk::insert_char(&mut app.state, c),
        _ => {}
    }
}

/// player-row key handler for the web shell. cursor navigation
/// works; activation drives the html-audio backend via
/// `app.player`. when no backend is attached we surface a friendly
/// hint instead.
fn on_player_row_key_web(
    app: &mut App,
    code: KeyCode,
    action_tx: &mpsc::UnboundedSender<AppAction>,
) {
    use crate::ratcore::app::ReplStatus;
    use crate::ratcore::player_row_keys as prk;
    use crate::ratcore::transport::PlayerCmd;
    match code {
        KeyCode::Esc | KeyCode::Char('q') => prk::leave(&mut app.state),
        KeyCode::Left | KeyCode::Char('h') => prk::cursor_left(&mut app.state),
        KeyCode::Right | KeyCode::Char('l') => prk::cursor_right(&mut app.state),
        KeyCode::Tab => prk::tab_or_leave(&mut app.state),
        // 'f' shortcut for favorite, regardless of cursor position.
        KeyCode::Char('f') => {
            if let Some(cur) = app.state.ephemeral.music.currently_playing() {
                let id = cur.id.clone();
                let _ = action_tx.unbounded_send(AppAction::ToggleFavorite {
                    target_type: "song".into(),
                    target_id: id,
                });
            } else {
                app.state.ephemeral.repl.status =
                    Some(ReplStatus::info("no track loaded".to_string()));
            }
        }
        KeyCode::Enter | KeyCode::Char(' ') => {
            let action = prk::activate(&app.state);
            let cmd = match action {
                prk::PlayerRowAction::Previous => {
                    play_previous_web(app, action_tx);
                    None
                }
                prk::PlayerRowAction::PlayPause => match app.state.ephemeral.music.player_state {
                    crate::ratcore::app::PlayerState::Playing => Some(PlayerCmd::Pause),
                    _ => Some(PlayerCmd::Play),
                },
                prk::PlayerRowAction::Next => {
                    play_next_web(app, action_tx);
                    None
                }
                prk::PlayerRowAction::SeekBack => {
                    let target = app.state.ephemeral.music.position_ms.saturating_sub(15_000);
                    Some(PlayerCmd::Seek(target))
                }
                prk::PlayerRowAction::SeekForward => {
                    let target = app.state.ephemeral.music.position_ms.saturating_add(15_000);
                    Some(PlayerCmd::Seek(target))
                }
                prk::PlayerRowAction::VolumeDown => {
                    let v = (app.state.ephemeral.music.volume - 0.05).clamp(0.0, 1.0);
                    app.state.ephemeral.music.volume = v;
                    Some(PlayerCmd::SetVolume(v))
                }
                prk::PlayerRowAction::VolumeUp => {
                    let v = (app.state.ephemeral.music.volume + 0.05).clamp(0.0, 1.0);
                    app.state.ephemeral.music.volume = v;
                    Some(PlayerCmd::SetVolume(v))
                }
                prk::PlayerRowAction::Favorite => {
                    if let Some(cur) = app.state.ephemeral.music.currently_playing() {
                        let id = cur.id.clone();
                        let _ = action_tx.unbounded_send(AppAction::ToggleFavorite {
                            target_type: "song".into(),
                            target_id: id,
                        });
                    } else {
                        app.state.ephemeral.repl.status =
                            Some(ReplStatus::info("no track loaded".to_string()));
                    }
                    None
                }
            };
            if let Some(cmd) = cmd {
                send_player_web(app, cmd);
            }
        }
        _ => {}
    }
}

/// fire-and-forget helper to dispatch a `PlayerCmd` to the web
/// shell's audio backend, if one is attached. errors are surfaced
/// as a transient repl status message.
fn send_player_web(app: &mut App, cmd: crate::ratcore::transport::PlayerCmd) {
    use crate::ratcore::app::ReplStatus;
    let Some(player) = app.player.clone() else {
        app.state.ephemeral.repl.status =
            Some(ReplStatus::err("no audio backend attached".to_string()));
        return;
    };
    wasm_bindgen_futures::spawn_local(async move {
        if let Err(e) = player.send(cmd).await {
            web_sys::console::warn_1(&format!("rathole: player.send: {e}").into());
        }
    });
}

/// apply a `MusicEvent` from the html-audio backend to ui state.
/// kept identical to the tty's helper so behaviour stays in lock-step.
fn apply_music_event_web(
    app: &mut App,
    ev: crate::ratcore::app::MusicEvent,
    action_tx: &mpsc::UnboundedSender<AppAction>,
) {
    use crate::ratcore::app::MusicEvent;
    match ev {
        MusicEvent::State(s) => app.state.ephemeral.music.player_state = s,
        MusicEvent::Progress { ms, total_ms } => {
            let m = &mut app.state.ephemeral.music;
            m.position_ms = ms;
            m.duration_ms = total_ms;
        }
        MusicEvent::TrackChanged { .. } => {
            // single-track loads: rathole already owns m.current.
            app.state.ephemeral.music.position_ms = 0;
        }
        MusicEvent::QueueResolveProgress { remaining } => {
            app.state.ephemeral.music.queue_resolving = remaining;
        }
        MusicEvent::Ended => {
            // auto-advance through the local queue.
            let next = app
                .state
                .ephemeral
                .music
                .current
                .map(|c| c + 1)
                .unwrap_or(0);
            play_index_web(app, next, action_tx);
        }
        MusicEvent::Error(e) => app.state.ephemeral.music.last_event_error = Some(e),
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
            // ctrl-k / cmd-k: enter the repl from any focus.
            if (ev.ctrl_key() || ev.meta_key()) && (key == "k" || key == "K") {
                ev.prevent_default();
                ev.stop_propagation();
                let mut app = app_for_keys.borrow_mut();
                crate::ratcore::repl_keys::enter(&mut app.state);
                return;
            }
            // bare '/' (no modifiers): also opens the repl, with `/`
            // already typed. matches the vim/less convention. skipped
            // when focus is a text input so `/` can be entered as a
            // literal character there. browsers sometimes intercept
            // `/` for quick-find (firefox) so we always
            // prevent_default when claiming it.
            if !ev.ctrl_key() && !ev.meta_key() && !ev.alt_key() && key == "/" {
                let mut app = app_for_keys.borrow_mut();
                let in_music_text_input = matches!(app.state.ephemeral.focus, Focus::MusicView)
                    && matches!(
                        app.state.ephemeral.music.mode,
                        crate::ratcore::app::MusicMode::Search
                    );
                if !matches!(
                    app.state.ephemeral.focus,
                    Focus::PeerInput | Focus::CommandForm | Focus::Repl
                ) && !in_music_text_input
                {
                    ev.prevent_default();
                    ev.stop_propagation();
                    crate::ratcore::repl_keys::enter_with_seed(&mut app.state, "/");
                    return;
                }
            }
            // ctrl-p / cmd-p: toggle player-row controls.
            if (ev.ctrl_key() || ev.meta_key()) && (key == "p" || key == "P") {
                ev.prevent_default();
                ev.stop_propagation();
                let mut app = app_for_keys.borrow_mut();
                if matches!(app.state.ephemeral.focus, Focus::PlayerRow) {
                    crate::ratcore::player_row_keys::leave(&mut app.state);
                } else {
                    crate::ratcore::player_row_keys::enter(&mut app.state);
                }
                return;
            }
            // ctrl-m / cmd-m: jump to music view.
            if (ev.ctrl_key() || ev.meta_key()) && (key == "m" || key == "M") {
                ev.prevent_default();
                ev.stop_propagation();
                let mut app = app_for_keys.borrow_mut();
                let eph = &mut app.state.ephemeral;
                eph.focus = Focus::MusicView;
                eph.music.mode = crate::ratcore::app::MusicMode::Results;
                return;
            }
            // ctrl-r / cmd-r: open the connect-remote modal.
            // (cmd-r is browser refresh, but we prevent_default to claim it.)
            if (ev.ctrl_key() || ev.meta_key()) && (key == "r" || key == "R") {
                ev.prevent_default();
                ev.stop_propagation();
                let mut app = app_for_keys.borrow_mut();
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
            if !matches!(
                focus,
                Focus::PeerInput | Focus::CommandForm | Focus::MusicView | Focus::Repl
            ) {
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
                Focus::MusicView if eph.music.mode == crate::ratcore::app::MusicMode::Search => {
                    ti::insert_str(&mut eph.music.query, &mut eph.music.query_cursor, &text);
                }
                Focus::MusicView => {}
                Focus::Repl => {
                    ti::insert_str(&mut eph.repl.input, &mut eph.repl.cursor, &text);
                    eph.repl.history_cursor = None;
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

/// install a window-level `resize` listener. ratzilla's WebGl2Backend
/// already polls canvas client_width/height on every draw frame and
/// reflows the grid automatically, so this listener is a belt-and-
/// braces hook: it logs the new dimensions for diagnostics and
/// guarantees a paint happens immediately on resize (instead of
/// waiting for the next idle RAF tick) so the user sees the reflow
/// without a perceptible delay.
fn install_resize_listener() -> Result<(), JsValue> {
    let win = web_sys::window().ok_or_else(|| JsValue::from_str("no window"))?;
    let win_for_cb = win.clone();
    let cb = Closure::<dyn FnMut(web_sys::Event)>::new(move |_ev: web_sys::Event| {
        let w = win_for_cb
            .inner_width()
            .ok()
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);
        let h = win_for_cb
            .inner_height()
            .ok()
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);
        web_sys::console::debug_2(
            &"rathole: window resize".into(),
            &format!("{}x{}", w as i32, h as i32).into(),
        );
        // request a single extra animation frame so the next draw
        // loop iteration sees the new canvas client size.
        let nudge = Closure::<dyn FnMut(f64)>::new(move |_t: f64| {});
        let _ = win_for_cb.request_animation_frame(nudge.as_ref().unchecked_ref());
        nudge.forget();
    });
    win.add_event_listener_with_callback("resize", cb.as_ref().unchecked_ref())?;
    cb.forget();
    Ok(())
}
