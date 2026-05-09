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
use crate::ratcore::app::DispatchResponse;
use crate::ratcore::app::{
    AdminCommand, App, AppAction, AppState, ArgKind, CommandForm, CommandKind, FieldState, Focus,
    LastDispatch, PersistedState, ReplStatus, SelectOption,
};
use crate::ratcore::catalog;
use crate::ratcore::transport::Transport;
use crate::ratcore::views::{self, command_form};

/// build the seed command list. shared across both shells via
/// `ratcore::catalog`. for entries also present in grimoire's
/// admin registry, copy the registry's `auth` string in so the
/// palette badges match. anything in the catalog that isn't in
/// the registry (e.g. `server_info`, `knock`) keeps the catalog
/// default.
fn build_commands() -> Vec<AdminCommand> {
    let mut cmds = catalog::commands();
    let registry = grimoire::admin_dispatch::registry::all_commands();
    for cmd in cmds.iter_mut() {
        if let Some(info) = registry.iter().find(|c| c.name == cmd.name) {
            cmd.auth = info.auth.as_str().to_string();
        }
    }
    cmds
}

pub async fn run(terminal: ratatui::DefaultTerminal, opts: LaunchOpts) -> color_eyre::Result<()> {
    // wrap in a LocalSet so we can use `tokio::task::spawn_local` —
    // the `Transport` trait is `?Send` (matches the wasm shell's
    // single-threaded constraint) so we can't use `tokio::spawn`.
    let local = LocalSet::new();
    local.run_until(run_inner(terminal, opts)).await
}

async fn run_inner(
    mut terminal: ratatui::DefaultTerminal,
    opts: LaunchOpts,
) -> color_eyre::Result<()> {
    let commands = build_commands();
    let persisted: PersistedState = persist::load().unwrap_or_else(|e| {
        tracing::warn!("rathole: statefile load failed ({e}); using defaults");
        PersistedState::default()
    });
    let mut state = AppState::from_persisted(persisted);
    // hydrate the most-recently-active remote so the peer input is
    // pre-filled and the header shows where the user last connected.
    if let Some(addr) = load_recent_peer().await {
        state.ephemeral.connected_peer = Some(addr);
    }
    let transport: Rc<dyn Transport> = Rc::new(LocalTransport::from_first_root().await?);
    let (action_tx, mut action_rx) = mpsc::unbounded_channel::<AppAction>();
    let player = super::player::RodioPlayer::spawn(action_tx.clone());
    let mut app = App::new(state, transport, commands).with_player(player);

    // build the serve subprocess monitor. uses the same binary the
    // user invoked (so dev `cargo run --bin freqhole` keeps using
    // the dev build) and forwards the same --config path so both
    // processes see the same db / log file. failures here are
    // non-fatal: monitor just won't be able to spawn anything.
    let mut serve_monitor = match std::env::current_exe() {
        Ok(bin) => Some(super::serve_monitor::ServeMonitor::new(
            bin,
            opts.config.clone(),
        )),
        Err(e) => {
            tracing::warn!("rathole: current_exe failed ({e}); /serve disabled");
            None
        }
    };

    // autostart the serve subprocess based on the persisted config
    // flags. set by the setup wizard (or hand-edited in
    // freqhole-config.toml). `serve` (auto) handles both http and
    // p2p subject to the same config flags, so we only need to pick
    // a more specific kind when exactly one is enabled.
    if let Some(monitor) = serve_monitor.as_mut() {
        let cfg = grimoire::config::get_config();
        let http_on = cfg.server.as_ref().map(|s| s.enabled).unwrap_or(false);
        let p2p_on = cfg.federation.as_ref().map(|f| f.enabled).unwrap_or(false);
        let kind = match (http_on, p2p_on) {
            (true, true) => Some(super::serve_monitor::ServeKind::Auto),
            (true, false) => Some(super::serve_monitor::ServeKind::Http),
            (false, true) => Some(super::serve_monitor::ServeKind::P2p),
            (false, false) => None,
        };
        if let Some(kind) = kind {
            if let Err(e) = monitor.start(kind) {
                tracing::warn!("rathole: serve autostart failed: {e}");
            } else {
                tracing::info!("rathole: serve autostarted ({:?})", kind);
            }
            sync_serve_badge(&mut app, monitor);
        }
    }

    // background job processor. picks up any pending jobs left over
    // from a prior session (e.g. a music scan the user backgrounded
    // out of the wizard, or a previous rathole that was closed
    // mid-scan). runs for the lifetime of the tty and is gracefully
    // cancelled on exit so the current job (if any) can finish before
    // shutdown. note: any jobs that were "claimed" but not finished
    // when a previous process died hard will be re-picked-up by
    // grimoire's job queue once their lock expires.
    let job_proc_token = grimoire::jobs::CancellationToken::new();
    let job_proc_handle = {
        let token = job_proc_token.clone();
        tokio::spawn(async move {
            let _ = grimoire::jobs::run_job_processor_with_token(token).await;
        })
    };

    // forward grimoire broadcast events (job progress, knock create/
    // process) into the ui loop so the top-bar badges + bell stay
    // current. uses tokio::spawn (not spawn_local) so the broadcast
    // receiver lives outside the LocalSet — `AppAction` is Send.
    let grimoire_events_handle = {
        let tx = action_tx.clone();
        tokio::spawn(async move {
            let mut rx = grimoire::events::subscribe();
            // remember the kind we classified each session as, so the
            // top-bar label doesn't flip from "fetch" to "scan" once
            // the FetchMedia row finishes and child ProcessFile rows
            // start emitting progress with concrete file paths.
            let mut session_kinds: std::collections::HashMap<String, &'static str> =
                std::collections::HashMap::new();
            loop {
                match rx.recv().await {
                    Ok(ev) => {
                        let action = match ev {
                            grimoire::events::GrimoireEvent::JobProgress {
                                session_id,
                                directory,
                                songs_added,
                                jobs_pending,
                                jobs_total,
                            } => {
                                // first event for a session classifies
                                // it; subsequent events keep the same
                                // label even if `directory` switches
                                // shape (fetch → child file paths).
                                let kind =
                                    *session_kinds.entry(session_id.clone()).or_insert_with(|| {
                                        if directory.starts_with("fetch://")
                                            || directory.starts_with("http://")
                                            || directory.starts_with("https://")
                                        {
                                            "fetch"
                                        } else {
                                            "scan"
                                        }
                                    });
                                AppAction::JobProgress {
                                    session_id,
                                    kind: kind.to_string(),
                                    songs_added,
                                    jobs_pending,
                                    jobs_total,
                                }
                            }
                            grimoire::events::GrimoireEvent::JobSessionComplete {
                                session_id,
                                ..
                            } => {
                                session_kinds.remove(&session_id);
                                AppAction::JobSessionComplete { session_id }
                            }
                            grimoire::events::GrimoireEvent::KnockCreated {
                                id, username, ..
                            } => AppAction::KnockCreated {
                                id,
                                username: Some(username),
                            },
                            grimoire::events::GrimoireEvent::KnockProcessed { id, .. } => {
                                AppAction::KnockProcessed { id }
                            }
                        };
                        if tx.send(action).is_err() {
                            break;
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
        })
    };

    let mut events = EventStream::new();
    let mut tick = tokio::time::interval(Duration::from_millis(250));

    while !app.exit {
        terminal.draw(|f| views::draw(f, &mut app))?;
        tokio::select! {
            maybe_ev = events.next() => match maybe_ev {
                Some(Ok(ev)) => on_event(&mut app, ev, &action_tx),
                Some(Err(e)) => return Err(color_eyre::eyre::eyre!("input stream error: {e}")),
                None => break,
            },
            _ = tick.tick() => {
                // poll the serve subprocess so the badge reacts to
                // exits without waiting for the user to act.
                if let Some(m) = serve_monitor.as_mut() {
                    m.refresh();
                    sync_serve_badge(&mut app, m);
                }
            }
            Some(action) = action_rx.recv() => {
                if handle_serve_action(&mut app, &action, serve_monitor.as_mut()) {
                    continue;
                }
                on_action(&mut app, action, &action_tx);
            }
        }
    }

    if let Err(e) = persist::save(&app.state.persisted) {
        tracing::warn!("rathole: statefile save failed: {e}");
    }
    // graceful shutdown: tell the job processor to stop after its
    // current job, then give it a few seconds to wind down. if it
    // doesn't finish in time we drop the handle and let the runtime
    // tear it down (the current job will be re-claimed next launch
    // once the row's claim lock expires).
    job_proc_token.cancel();
    if let Err(e) = tokio::time::timeout(Duration::from_secs(5), job_proc_handle).await {
        tracing::warn!("rathole: job processor did not stop within 5s ({e}); abandoning");
    }
    grimoire_events_handle.abort();
    Ok(())
}

fn on_event(app: &mut App, ev: Event, action_tx: &mpsc::UnboundedSender<AppAction>) {
    // bracketed paste arrives as one event for the whole pasted string.
    // route it to the focused field if any.
    if let Event::Paste(text) = ev {
        if matches!(app.state.ephemeral.focus, Focus::PeerInput) {
            use crate::ratcore::text_input as ti;
            let eph = &mut app.state.ephemeral;
            ti::insert_str(&mut eph.peer_input, &mut eph.peer_cursor, &text);
        } else if matches!(app.state.ephemeral.focus, Focus::MusicView)
            && app.state.ephemeral.music.mode == crate::ratcore::app::MusicMode::Search
        {
            use crate::ratcore::text_input as ti;
            let m = &mut app.state.ephemeral.music;
            ti::insert_str(&mut m.query, &mut m.query_cursor, &text);
        } else if matches!(app.state.ephemeral.focus, Focus::Repl) {
            use crate::ratcore::text_input as ti;
            let r = &mut app.state.ephemeral.repl;
            ti::insert_str(&mut r.input, &mut r.cursor, &text);
            r.history_cursor = None;
        }
        return;
    }
    let Event::Key(k) = ev else { return };
    if k.kind != KeyEventKind::Press {
        return;
    }

    // global hotkey: only ctrl-c quits. all other navigation is
    // driven through the slash repl ('/' anywhere) — no cmd/ctrl
    // letter chords (which were unreliable on macOS terminals
    // anyway) and no single-letter landing shortcuts.
    let cmdlike =
        KeyModifiers::CONTROL | KeyModifiers::SUPER | KeyModifiers::META | KeyModifiers::ALT;
    if k.modifiers.intersects(cmdlike) && matches!(k.code, KeyCode::Char('c')) {
        app.exit = true;
        return;
    }
    // pending-quit confirm overlay swallows all keys until resolved.
    // (the bare-`q` shortcut was removed; this branch only fires
    // when something else — e.g. a future menu item — sets
    // `pending_quit`. left intact so the overlay still works.)
    if app.state.ephemeral.pending_quit {
        match k.code {
            KeyCode::Char('y') | KeyCode::Char('Y') | KeyCode::Enter => {
                app.exit = true;
            }
            _ => {
                app.state.ephemeral.pending_quit = false;
            }
        }
        return;
    }

    match (k.code, k.modifiers) {
        // bare '/' opens the slash repl with `/` already typed,
        // matching the convention used by vim/less/spotlight. skip
        // when the focused area is itself a text input (peer modal,
        // form, music search box, repl) so users can still type a
        // literal '/' there. on the music view, only the Search
        // sub-mode is a text input — Results, Queue, Library are
        // navigable and should fall through to opening the repl.
        (KeyCode::Char('/'), m) if m.is_empty() => {
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
        _ => {}
    }

    // dispatch to focused area
    match app.state.ephemeral.focus {
        Focus::Landing => on_landing_key(app, k.code, action_tx),
        Focus::AdminPalette => on_palette_key(app, k.code, action_tx),
        Focus::PeerInput => on_peer_input_key(app, k.code),
        Focus::CommandForm => on_form_key(app, k.code, k.modifiers, action_tx),
        Focus::ResultPanel => on_result_panel_key(app, k.code, k.modifiers),
        Focus::ResultActionMenu => on_action_menu_key(app, k.code, action_tx),
        Focus::MusicView => on_music_key(app, k.code, action_tx),
        Focus::Repl => on_repl_key(app, k.code, k.modifiers, action_tx),
        Focus::PlayerRow => on_player_row_key(app, k.code, action_tx),
        Focus::RemoteList => on_remote_list_key_tty(app, k.code, action_tx),
    }
}

/// landing-screen key handler. landing is intentionally minimal:
/// the `/` global hotkey opens the slash repl, `q` quits, and
/// everything else is a no-op. no single-letter shortcuts here
/// anymore — the repl + flyout are the one true command surface.
fn on_landing_key(_app: &mut App, _code: KeyCode, _action_tx: &mpsc::UnboundedSender<AppAction>) {}

fn on_palette_key(app: &mut App, code: KeyCode, _action_tx: &mpsc::UnboundedSender<AppAction>) {
    // the palette body is now just the result viewer; the left
    // commands list and inline filter were dropped in favor of the
    // bottom slash repl + flyout. arrow keys scroll the result
    // body, tab promotes to ResultPanel for row-cursor + actions,
    // esc bails to landing.
    let eph = &mut app.state.ephemeral;
    match code {
        KeyCode::Esc => {
            eph.focus = Focus::Landing;
        }
        KeyCode::Tab => {
            eph.focus = Focus::ResultPanel;
        }
        KeyCode::Up => {
            eph.last_dispatch_scroll = eph.last_dispatch_scroll.saturating_sub(1);
        }
        KeyCode::Down => {
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

fn on_peer_input_key(app: &mut App, code: KeyCode) {
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
            // tty has no MiddenTransport yet — just remember the addr
            // so the next launch (or a future m5 refactor) can use it.
            let addr = eph.peer_input.trim().to_string();
            if addr.is_empty() {
                eph.peer_error = Some("peer addr is empty".to_string());
                return;
            }
            eph.connected_peer = Some(addr.clone());
            eph.peer_input.clear();
            eph.peer_cursor = 0;
            eph.peer_error = None;
            eph.focus = Focus::AdminPalette;
            // persist into grimoire's remotez table so it sticks
            // across restarts (and is shared with the rest of
            // freqhole's clients via the same sqlite db).
            persist_peer_addr(addr);
        }
        KeyCode::Char(c) => {
            if !c.is_control() {
                ti::insert_char(&mut eph.peer_input, &mut eph.peer_cursor, c);
            }
        }
        _ => {}
    }
}

/// intercept serve-related app actions so we can route them to the
/// subprocess monitor before falling through to the generic
/// `on_action` dispatcher. returns `true` when the action was
/// consumed and the caller should skip its normal handling.
fn handle_serve_action(
    app: &mut App,
    action: &AppAction,
    monitor: Option<&mut super::serve_monitor::ServeMonitor>,
) -> bool {
    use super::serve_monitor::ServeKind;
    use crate::ratcore::app::{ReplStatus, ServeKindRequest};

    match action {
        AppAction::ServeStart { kind } => {
            let Some(monitor) = monitor else {
                app.state.ephemeral.repl.status = Some(ReplStatus::err(
                    "serve unavailable: current_exe lookup failed",
                ));
                return true;
            };
            let mapped = match kind {
                ServeKindRequest::Auto => ServeKind::Auto,
                ServeKindRequest::Http => ServeKind::Http,
                ServeKindRequest::P2p => ServeKind::P2p,
            };
            match monitor.start(mapped) {
                Ok(()) => {
                    app.state.ephemeral.repl.status = Some(ReplStatus::ok(format!(
                        "started {}",
                        match kind {
                            ServeKindRequest::Auto => "serve",
                            ServeKindRequest::Http => "http",
                            ServeKindRequest::P2p => "p2p",
                        }
                    )));
                }
                Err(e) => {
                    app.state.ephemeral.repl.status =
                        Some(ReplStatus::err(format!("serve start failed: {e}")));
                }
            }
            sync_serve_badge(app, monitor);
            true
        }
        AppAction::ServeStop => {
            let Some(monitor) = monitor else {
                app.state.ephemeral.repl.status =
                    Some(ReplStatus::err("no serve subprocess to stop"));
                return true;
            };
            match monitor.stop() {
                Ok(()) => {
                    app.state.ephemeral.repl.status = Some(ReplStatus::ok("serve stopped"));
                }
                Err(e) => {
                    app.state.ephemeral.repl.status =
                        Some(ReplStatus::err(format!("serve stop: {e}")));
                }
            }
            sync_serve_badge(app, monitor);
            true
        }
        _ => false,
    }
}

/// translate the monitor's snapshot into the portable `ServeBadge`
/// the views layer reads, and stash it on `EphemeralState`.
fn sync_serve_badge(app: &mut App, monitor: &super::serve_monitor::ServeMonitor) {
    use super::serve_monitor::{ServeKind, ServeStatus};
    use crate::ratcore::app::{ServeBadge, ServeMode};

    let map_kind = |k: ServeKind| match k {
        ServeKind::Auto => ServeMode::Auto,
        ServeKind::Http => ServeMode::Http,
        ServeKind::P2p => ServeMode::P2p,
    };

    let badge = match monitor.status() {
        ServeStatus::Stopped => ServeBadge::default(),
        ServeStatus::Running { kind, pid } => ServeBadge {
            mode: map_kind(kind),
            running: true,
            pid: Some(pid),
            last_message: None,
        },
        ServeStatus::Exited { kind, code } => ServeBadge {
            mode: map_kind(kind),
            running: false,
            pid: None,
            last_message: Some(format!(
                "exited (code {})",
                code.map(|c| c.to_string())
                    .unwrap_or_else(|| "signal".into())
            )),
        },
        ServeStatus::SpawnError { message } => ServeBadge {
            mode: ServeMode::None,
            running: false,
            pid: None,
            last_message: Some(message),
        },
    };

    app.state.ephemeral.serve = badge;
}

fn on_action(app: &mut App, action: AppAction, action_tx: &mpsc::UnboundedSender<AppAction>) {
    match action {
        AppAction::AdminDispatchResult { command, response } => {
            let data_pretty = response
                .data
                .as_ref()
                .map(|d| serde_json::to_string_pretty(d).unwrap_or_else(|_| d.to_string()));
            // close any open form and return to palette focus on
            // success (or when the dispatch wasn't for the focused
            // form). on failure of the form's command, keep the form
            // open and surface the error inline.
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
        // tty shell never produces these (no peer concept), but the
        // enum is shared with the web shell so we need to be exhaustive.
        AppAction::PeerConnectResult { .. }
        | AppAction::LocalNodeReady { .. }
        | AppAction::RemoteHello { .. } => {}
        AppAction::RemotesLoaded { remotes } => {
            let eph = &mut app.state.ephemeral;
            eph.remotes_view = remotes;
            // clamp cursor in case the list shrank.
            let len = eph.remotes_view.len();
            eph.remotes_view_cursor = if len == 0 {
                0
            } else {
                eph.remotes_view_cursor.min(len - 1)
            };
        }
        AppAction::MusicSearchResults { query, result } => {
            let m = &mut app.state.ephemeral.music;
            // ignore stale responses (user kept typing).
            if m.query.trim() != query.trim() {
                return;
            }
            m.searching = false;
            match result {
                Ok(rows) => {
                    m.search_error = None;
                    m.results = rows;
                    m.results_cursor = 0;
                    if !m.results.is_empty() {
                        m.mode = crate::ratcore::app::MusicMode::Results;
                    }
                    // consume the auto-play flag set by `/play <query>`.
                    if m.auto_play_on_results && !m.results.is_empty() {
                        m.auto_play_on_results = false;
                        play_one_at_cursor(app, action_tx);
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
            // refresh favorited-status whenever the playing track changes.
            let track_changed = matches!(ev, crate::ratcore::app::MusicEvent::TrackChanged { .. });
            apply_music_event(app, ev, action_tx);
            if track_changed {
                if let Some(cur) = app.state.ephemeral.music.currently_playing() {
                    let id = cur.id.clone();
                    let transport = app.transport.clone();
                    let tx = action_tx.clone();
                    tokio::task::spawn_local(async move {
                        let result = transport.is_favorited("song", &id).await;
                        let _ = tx.send(AppAction::FavoriteResult {
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
            tokio::task::spawn_local(async move {
                let result = transport.toggle_favorite(&tt, &tid).await;
                let _ = tx.send(AppAction::FavoriteResult {
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
        // collection loaded: rathole-side queue replace + play. used by
        // play_collection's spawn_local once songs are fetched.
        AppAction::CollectionLoaded { songs } => {
            if !songs.is_empty() {
                play_now(app, songs, 0, action_tx);
            }
        }
        AppAction::CollectionEnqueued { songs } => {
            // append rows to the local queue. enqueue_now starts
            // playback if nothing was loaded.
            let n = songs.len();
            enqueue_now(app, songs, action_tx);
            app.state.ephemeral.repl.status = Some(crate::ratcore::app::ReplStatus::ok(format!(
                "queued {n} track{}",
                if n == 1 { "" } else { "s" }
            )));
        }
        // serve actions are intercepted by `handle_serve_action`
        // before reaching this dispatcher; reaching them here means
        // the monitor was unavailable and the action was already
        // converted into a repl status by the interceptor, so
        // there's nothing to do.
        AppAction::ServeStart { .. } | AppAction::ServeStop => {}
        AppAction::JobProgress {
            session_id,
            kind,
            songs_added: _,
            jobs_pending,
            jobs_total,
        } => {
            let percent = if jobs_total > 0 {
                let done = jobs_total.saturating_sub(jobs_pending);
                ((done as u64 * 100) / jobs_total as u64) as u8
            } else {
                0
            };
            app.state.ephemeral.jobs_status = Some(crate::ratcore::app::JobsStatus {
                kind,
                percent,
                jobs_total,
                jobs_pending,
            });
            let _ = session_id;
        }
        AppAction::JobSessionComplete { session_id: _ } => {
            app.state.ephemeral.jobs_status = None;
        }
        AppAction::KnockCreated { id: _, username: _ } => {
            app.state.ephemeral.pending_knocks =
                app.state.ephemeral.pending_knocks.saturating_add(1);
        }
        AppAction::KnockProcessed { id: _ } => {
            app.state.ephemeral.pending_knocks =
                app.state.ephemeral.pending_knocks.saturating_sub(1);
        }
    }
}

fn apply_music_event(
    app: &mut App,
    ev: crate::ratcore::app::MusicEvent,
    tx: &mpsc::UnboundedSender<AppAction>,
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
            // rodio's internal queue is single-track now, so its
            // TrackChanged is just "loaded the one track we sent".
            // m.current is already authoritative on the rathole side;
            // ignore the index from the event.
            app.state.ephemeral.music.position_ms = 0;
        }
        MusicEvent::QueueResolveProgress { remaining } => {
            app.state.ephemeral.music.queue_resolving = remaining;
        }
        MusicEvent::Ended => {
            // rodio finished the single track we loaded. advance to
            // the next row in the local queue, or stop if we've run
            // off the end. play_index handles both cases.
            let next = app
                .state
                .ephemeral
                .music
                .current
                .map(|c| c + 1)
                .unwrap_or(0);
            play_index(app, next, tx);
        }
        MusicEvent::Error(e) => app.state.ephemeral.music.last_event_error = Some(e),
    }
}

// =========================================================================
// result-panel + form handlers (parity with the web shell)
// =========================================================================

/// dispatch an admin command on the tty's local transport and forward
/// the result back through the action channel.
fn spawn_admin_dispatch(
    app: &App,
    name: &str,
    body: serde_json::Value,
    tx: &mpsc::UnboundedSender<AppAction>,
) {
    let transport = app.transport.clone();
    let tx = tx.clone();
    let name = name.to_string();
    tokio::task::spawn_local(async move {
        let response = transport.admin_dispatch(&name, body).await;
        let _ = tx.send(AppAction::AdminDispatchResult {
            command: name,
            response,
        });
    });
}

fn on_result_panel_key(app: &mut App, code: KeyCode, mods: KeyModifiers) {
    let eph = &mut app.state.ephemeral;
    let big = mods.contains(KeyModifiers::SHIFT);
    let has_rows = eph
        .last_dispatch
        .as_ref()
        .map(|ld| !ld.rows.is_empty())
        .unwrap_or(false);
    match code {
        KeyCode::Esc => eph.focus = Focus::AdminPalette,
        // tab cycles forward to the player row from the result panel
        // (palette → result → player → palette). esc still bails to
        // the palette directly.
        KeyCode::Tab => {
            crate::ratcore::player_row_keys::enter(&mut app.state);
        }
        KeyCode::Up => {
            let step = if big { 10 } else { 1 };
            if has_rows {
                if big {
                    // shift+up scrolls focused-row json instead of moving the cursor.
                    eph.last_dispatch_scroll = eph.last_dispatch_scroll.saturating_sub(step);
                } else if let Some(ld) = eph.last_dispatch.as_mut() {
                    ld.cursor = ld.cursor.saturating_sub(step as usize);
                    eph.last_dispatch_scroll = 0;
                }
            } else {
                eph.last_dispatch_scroll = eph.last_dispatch_scroll.saturating_sub(step);
            }
        }
        KeyCode::Down => {
            let step = if big { 10 } else { 1 };
            if has_rows {
                if big {
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
        KeyCode::Enter => {
            // open the per-row action menu — `result_actions` always
            // returns at least the generic "view full row" option,
            // so any focused row will produce a menu. /help rows are
            // a special case: they route back through the slash
            // repl so enter dispatches the chosen command directly.
            if let Some(ld) = eph.last_dispatch.as_ref() {
                if let Some(row) = ld.rows.get(ld.cursor) {
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
            eph.last_dispatch_scroll = u16::MAX;
        }
        _ => {}
    }
}

fn on_form_key(
    app: &mut App,
    code: KeyCode,
    _mods: KeyModifiers,
    tx: &mpsc::UnboundedSender<AppAction>,
) {
    use crate::ratcore::text_input as ti;
    let Some(form) = app.state.ephemeral.form.as_mut() else {
        app.state.ephemeral.focus = Focus::AdminPalette;
        return;
    };
    if form.inflight {
        if code == KeyCode::Esc {
            app.state.ephemeral.form = None;
            app.state.ephemeral.focus = Focus::AdminPalette;
        }
        return;
    }

    // confirm step: Enter submits, Esc returns to the last field.
    // nothing else.
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

    // wizard step: one focused field at a time.
    // - Enter advances. on the last focusable field, advance to the
    //   confirm step.
    // - Esc cancels.
    // - ←/→ cycles options on OneOf / SelectFrom; cursor on Text.
    // - any printable char / backspace / delete / home / end edits
    //   the focused Text field.
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
        // Tab tries path completion when the focused Text/LongText
        // field looks path-like; otherwise advances the wizard.
        KeyCode::Tab => {
            let did_complete = try_form_path_complete(form);
            if !did_complete {
                advance_form(app, tx);
            }
        }
        // Enter advances UNLESS the focused field is a LongText
        // editor, in which case it inserts a newline.
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
                // LongText shares Text's text-editing keys; Enter is
                // handled above (newline) and Tab advances the wizard.
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
                    // accept digits anywhere; accept a leading '-'
                    // when `signed` and the cursor is at position 0.
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
                    // cycle backwards: unset <- true <- false <- unset
                    *value = match value {
                        None => Some(false),
                        Some(true) => None,
                        Some(false) => Some(true),
                    };
                }
                (FieldState::OptionalBool { value }, KeyCode::Right)
                | (FieldState::OptionalBool { value }, KeyCode::Char(' ')) => {
                    // cycle forwards: unset -> true -> false -> unset
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

/// try to perform filesystem path completion on the focused
/// Text/LongText field. returns true if the field's buffer was
/// rewritten (so the caller skips form-advancement).
///
/// trigger heuristic: buffer (or its tail past the last whitespace)
/// must start with `/`, `~/`, `./`, or `../`. partial paths get
/// completed against the parent directory's listing — single match
/// fills in fully (with trailing `/` for dirs); multi-match fills
/// in the longest common prefix.
fn try_form_path_complete(form: &mut CommandForm) -> bool {
    let Some(field) = form.fields.get_mut(form.focused) else {
        return false;
    };
    let (buf, cursor) = match field {
        FieldState::Text { buf, cursor } => (buf, cursor),
        FieldState::LongText { buf, cursor } => (buf, cursor),
        _ => return false,
    };
    let prefix: String = buf.chars().take(*cursor).collect();
    let suffix: String = buf.chars().skip(*cursor).collect();
    // find the path token at the end of `prefix` (split on whitespace).
    let token_start = prefix
        .rfind(|c: char| c.is_whitespace())
        .map(|i| i + 1)
        .unwrap_or(0);
    let token = &prefix[token_start..];
    if !looks_like_path(token) {
        return false;
    }
    let Some(completion) = path_complete(token) else {
        return false;
    };
    if completion == token {
        return false;
    }
    let new_prefix = format!("{}{}", &prefix[..token_start], completion);
    let new_cursor = new_prefix.chars().count();
    *buf = format!("{new_prefix}{suffix}");
    *cursor = new_cursor;
    form.error = None;
    true
}

fn looks_like_path(s: &str) -> bool {
    s.starts_with('/') || s.starts_with("~/") || s.starts_with("./") || s.starts_with("../")
}

fn path_complete(token: &str) -> Option<String> {
    use std::path::PathBuf;
    // expand leading ~/ to $HOME for fs lookups; preserve in the
    // completion so the user keeps their tilde-style path.
    let (expanded, original_root): (PathBuf, &str) = if let Some(rest) = token.strip_prefix("~/") {
        let home = std::env::var("HOME").ok()?;
        let mut p = PathBuf::from(home);
        if !rest.is_empty() {
            p.push(rest);
        }
        (p, "~/")
    } else {
        (PathBuf::from(token), "")
    };

    // the parent we list, and the leaf we filter by.
    let (parent, leaf): (PathBuf, String) = if token.ends_with('/') {
        (expanded.clone(), String::new())
    } else {
        let parent = expanded.parent()?.to_path_buf();
        let leaf = expanded
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();
        (parent, leaf)
    };
    // an empty parent path means the leaf is at the fs root or
    // current dir; default to "." so std::fs::read_dir works.
    let read_from = if parent.as_os_str().is_empty() {
        PathBuf::from(".")
    } else {
        parent.clone()
    };

    let entries = std::fs::read_dir(&read_from).ok()?;
    let mut matches: Vec<(String, bool)> = entries
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let name = e.file_name().to_str()?.to_string();
            if !name.starts_with(&leaf) {
                return None;
            }
            let is_dir = e.file_type().ok().map(|t| t.is_dir()).unwrap_or(false);
            Some((name, is_dir))
        })
        .collect();
    if matches.is_empty() {
        return None;
    }
    matches.sort_by(|a, b| a.0.cmp(&b.0));

    // longest common prefix across all matches.
    let common = longest_common_prefix(matches.iter().map(|(n, _)| n.as_str()));
    let chosen = if common.len() > leaf.len() {
        common
    } else if matches.len() == 1 {
        matches[0].0.clone()
    } else {
        return None;
    };

    // rebuild the full token: original root (`~/` or empty) +
    // parent's portion of the original token (everything before the
    // leaf) + completed name + trailing `/` if it's a dir + single match.
    let parent_in_token = if token.ends_with('/') {
        token.to_string()
    } else {
        let leaf_chars = leaf.chars().count();
        let token_chars: Vec<char> = token.chars().collect();
        let cut = token_chars.len().saturating_sub(leaf_chars);
        token_chars[..cut].iter().collect::<String>()
    };
    let mut out = if !original_root.is_empty() && parent_in_token.is_empty() {
        original_root.to_string()
    } else {
        parent_in_token
    };
    out.push_str(&chosen);
    if matches.len() == 1 && matches[0].1 && !out.ends_with('/') {
        out.push('/');
    }
    Some(out)
}

fn longest_common_prefix<'a, I: IntoIterator<Item = &'a str>>(iter: I) -> String {
    let mut iter = iter.into_iter();
    let Some(first) = iter.next() else {
        return String::new();
    };
    let mut prefix = first.to_string();
    for s in iter {
        let new_len = prefix
            .chars()
            .zip(s.chars())
            .take_while(|(a, b)| a == b)
            .count();
        prefix.truncate(
            prefix
                .char_indices()
                .nth(new_len)
                .map(|(i, _)| i)
                .unwrap_or(prefix.len()),
        );
        if prefix.is_empty() {
            break;
        }
    }
    prefix
}

/// Enter pressed on a wizard field: validate it locally, then
/// advance to the next field — or to the confirm step if we're on
/// the last one.
fn advance_form(app: &mut App, tx: &mpsc::UnboundedSender<AppAction>) {
    let Some(form) = app.state.ephemeral.form.as_mut() else {
        return;
    };
    // local per-field validation: required fields can't be blank /
    // unloaded. lets the user fix the field in-place rather than
    // bouncing back from the server.
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
/// to gate Enter advancement.
fn validate_focused(form: &CommandForm) -> Result<(), String> {
    let Some(state) = form.fields.get(form.focused) else {
        return Ok(());
    };
    // we don't have the spec name handy without the cmd; use index
    // as a fallback identifier for the message.
    let label = format!("field {}", form.focused + 1);
    match state {
        FieldState::Text { buf, .. } | FieldState::LongText { buf, .. } => {
            if buf.trim().is_empty() {
                // optional fields are allowed to be blank; we don't
                // know `required` here so accept and let `build_body`
                // reject required-but-empty at confirm time.
            }
            Ok(())
        }
        FieldState::Number { .. } | FieldState::Bool { .. } => Ok(()),
        FieldState::OptionalBool { .. } => Ok(()),
        FieldState::OneOf { .. } => Ok(()),
        FieldState::Mirror | FieldState::HiddenLocalNodeId => Ok(()),
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
        KeyCode::Up => {
            menu.selected = menu.selected.saturating_sub(1);
        }
        KeyCode::Down => {
            let max = menu.options.len().saturating_sub(1);
            menu.selected = (menu.selected + 1).min(max);
        }
        KeyCode::Enter => {
            let Some(opt) = menu.options.get(menu.selected).cloned() else {
                return;
            };
            let row = menu.row.clone();
            eph.action_menu = None;
            // generic "view row" sentinel: dump the json into the
            // resultz pane as a synthetic dispatch so the user can
            // page through it without leaving the result panel.
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
            // music play sentinels: pull the row's id and queue songs
            // through the transport, then load them into the player.
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
                play_collection(app, kind, id, title, tx);
                return;
            }
            // enqueue collection sentinels: same as __play_*__ but
            // appends to the existing queue without interrupting the
            // current track.
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
                enqueue_collection(app, kind, id, title, tx);
                return;
            }
            if opt.target_command == "__enqueue_song__" {
                let (_, title, _) = crate::ratcore::catalog::row_id_and_title(&row);
                let title = title.unwrap_or_default();
                eph.focus = Focus::ResultPanel;
                enqueue_song_by_title(app, title, tx);
                return;
            }
            // pivot to the album-detail (songs of this album) or
            // artist-detail (albums by this artist) view by id.
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
                    fire_library_by_id(app, kind, parent_field, id, tx);
                } else {
                    // unified-search rows often lack one or both ids;
                    // resolve them lazily by looking up the row's own
                    // id (song or album) via the transport, then fire.
                    let row_kind = row
                        .get("type")
                        .and_then(|v| v.as_str())
                        .unwrap_or("song")
                        .to_string();
                    let row_id = crate::ratcore::catalog::row_id_and_title(&row).0;
                    if let Some(rid) = row_id {
                        resolve_then_goto(app, row_kind, rid, want_album, tx);
                    } else {
                        let label = if want_album { "album" } else { "artist" };
                        app.state.ephemeral.repl.status =
                            Some(ReplStatus::err(format!("no {label} id on this row")));
                    }
                }
                return;
            }
            // queue management sentinels: only valid when the source
            // command is the synthesized "queue" panel. each one
            // mutates the local queue state and re-issues a Load to
            // keep the player in sync (this briefly stops + restarts
            // playback, which is the simplest correct implementation
            // until we plumb finer-grained queue ops into rodio).
            if opt.target_command.starts_with("__queue_") {
                let position = row
                    .get("position")
                    .and_then(|v| v.as_u64())
                    .map(|n| n as usize);
                handle_queue_action(app, &opt.target_command, position, tx);
                return;
            }
            // play a single song row directly via search_songs(title)
            // — relies on the title field being unique enough. for
            // unified-search song rows the row already has media_blob_id
            // implicitly via the search index, but we don't pull it in
            // the row payload, so re-search by title.
            if opt.target_command == "__play_song__" {
                let (_, title, _) = crate::ratcore::catalog::row_id_and_title(&row);
                let title = title.unwrap_or_default();
                eph.focus = Focus::MusicView;
                eph.music.mode = crate::ratcore::app::MusicMode::Results;
                eph.music.query = title.clone();
                eph.music.query_cursor = title.chars().count();
                eph.music.auto_play_on_results = true;
                fire_search(app, tx);
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
                    let _ = tx.send(AppAction::ToggleFavorite {
                        target_type: kind.to_string(),
                        target_id: id,
                    });
                }
                return;
            }
            // add song / album to a playlist — open the existing
            // grimoire form with the song or album id prefilled.
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
            // find the target command and open a prefilled form.
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
            // any SelectFrom prefilled with a synthetic option will
            // skip the auto-fetch (options is Some). other SelectFrom
            // fields will fetch as usual when focused.
            maybe_fetch_select_options(app, tx);
        }
        _ => {}
    }
}

fn submit_form(app: &mut App, tx: &mpsc::UnboundedSender<AppAction>) {
    let Some(form) = app.state.ephemeral.form.as_ref() else {
        return;
    };
    let cmd_name = form.command.clone();
    let Some(cmd) = app.commands.iter().find(|c| c.name == cmd_name).cloned() else {
        return;
    };
    // tty has no iroh node id today; pass empty string for the
    // HiddenLocalNodeId placeholder (no shared admin commands use it).
    let body = match command_form::build_body(&cmd, form, None) {
        Ok(b) => b,
        Err(msg) => {
            if let Some(form) = app.state.ephemeral.form.as_mut() {
                form.error = Some(msg);
            }
            return;
        }
    };
    if let Some(form) = app.state.ephemeral.form.as_mut() {
        form.inflight = true;
        form.error = None;
    }
    match cmd.kind {
        CommandKind::Admin => spawn_admin_dispatch(app, &cmd_name, body, tx),
        CommandKind::Public { .. } => {
            // tty's LocalTransport doesn't have a public proxy channel;
            // surface the limitation instead of silently dropping.
            if let Some(form) = app.state.ephemeral.form.as_mut() {
                form.inflight = false;
                form.error =
                    Some("public commands aren't supported in the tty shell yet".to_string());
            }
        }
    }
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
    // when the body depends on sibling fields, options can go stale
    // any time those siblings change, so clear cached options on each
    // (re-)focus and re-fetch. for static-body fields, only fetch when
    // we don't have options yet.
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
    // resolve the body now (against the current form state) before
    // marking the field loading, so a sibling-not-ready error surfaces
    // synchronously instead of bouncing through a no-op fetch.
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
    tokio::task::spawn_local(async move {
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
        let _ = tx.send(AppAction::SelectFromOptionsReady {
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

// =========================================================================
// music view
// =========================================================================

fn on_music_key(app: &mut App, code: KeyCode, tx: &mpsc::UnboundedSender<AppAction>) {
    use crate::ratcore::app::{MusicMode, PlayerState};
    use crate::ratcore::text_input as ti;
    use crate::ratcore::transport::PlayerCmd;

    let mode = app.state.ephemeral.music.mode;
    match (mode, code) {
        (_, KeyCode::Esc) => {
            app.state.ephemeral.focus = Focus::Landing;
        }
        // global player toggle in either mode if something is playing/paused.
        (MusicMode::Results, KeyCode::Char(' ')) => {
            send_player(
                app,
                match app.state.ephemeral.music.player_state {
                    PlayerState::Playing => PlayerCmd::Pause,
                    _ => PlayerCmd::Play,
                },
                tx,
            );
        }
        (MusicMode::Results, KeyCode::Char('n')) => play_next(app, tx),
        (MusicMode::Results, KeyCode::Char('p')) => play_previous(app, tx),
        (MusicMode::Results, KeyCode::Left) => {
            let pos = app.state.ephemeral.music.position_ms;
            let new = pos.saturating_sub(5_000);
            send_player(app, PlayerCmd::Seek(new), tx);
        }
        (MusicMode::Results, KeyCode::Right) => {
            let m = &app.state.ephemeral.music;
            let new = (m.position_ms + 5_000).min(m.duration_ms.max(m.position_ms + 5_000));
            send_player(app, PlayerCmd::Seek(new), tx);
        }
        (MusicMode::Results, KeyCode::Char('-')) => adjust_volume(app, -0.05, tx),
        (MusicMode::Results, KeyCode::Char('=') | KeyCode::Char('+')) => {
            adjust_volume(app, 0.05, tx)
        }
        (MusicMode::Results, KeyCode::Char('/')) => {
            app.state.ephemeral.music.mode = MusicMode::Results;
        }
        (MusicMode::Results, KeyCode::Down) => {
            let m = &mut app.state.ephemeral.music;
            if !m.results.is_empty() {
                m.results_cursor = (m.results_cursor + 1).min(m.results.len() - 1);
            }
        }
        (MusicMode::Results, KeyCode::Up) => {
            let m = &mut app.state.ephemeral.music;
            m.results_cursor = m.results_cursor.saturating_sub(1);
        }
        (MusicMode::Results, KeyCode::Enter) => play_one_at_cursor(app, tx),
        // shift-A: play the row at cursor and queue everything
        // after it. distinct from bare Enter so /local + Enter on a
        // 200-row dump doesn't silently bury the rodio thread under
        // 200 decode-init attempts.
        (MusicMode::Results, KeyCode::Char('A')) => play_from_cursor(app, tx),
        (MusicMode::Results, KeyCode::Char('f')) => {
            // toggle favorite for the cursor row.
            let m = &app.state.ephemeral.music;
            if let Some(row) = m.results.get(m.results_cursor) {
                let _ = tx.send(AppAction::ToggleFavorite {
                    target_type: "song".into(),
                    target_id: row.id.clone(),
                });
            }
        }
        (MusicMode::Results, KeyCode::Tab) => {
            app.state.ephemeral.music.mode = MusicMode::Results;
        }
        // search mode: full text-edit + Enter to fire search.
        (MusicMode::Search, KeyCode::Enter) => fire_search(app, tx),
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
        (MusicMode::Search, KeyCode::Home) => {
            app.state.ephemeral.music.query_cursor = 0;
        }
        (MusicMode::Search, KeyCode::End) => {
            let m = &mut app.state.ephemeral.music;
            ti::move_end(&m.query, &mut m.query_cursor);
        }
        (MusicMode::Search, KeyCode::Char(c)) => {
            if !c.is_control() {
                let m = &mut app.state.ephemeral.music;
                ti::insert_char(&mut m.query, &mut m.query_cursor, c);
            }
        }
        _ => {}
    }
}

fn fire_search(app: &mut App, tx: &mpsc::UnboundedSender<AppAction>) {
    let q = app.state.ephemeral.music.query.trim().to_string();
    if q.is_empty() {
        app.state.ephemeral.music.search_error = Some("query is empty".to_string());
        return;
    }
    app.state.ephemeral.music.searching = true;
    app.state.ephemeral.music.search_error = None;
    let transport = app.transport.clone();
    let tx = tx.clone();
    let q_for_task = q.clone();
    tokio::task::spawn_local(async move {
        let result = transport.search_songs(&q_for_task, 100).await;
        let _ = tx.send(AppAction::MusicSearchResults {
            query: q_for_task,
            result,
        });
    });
}

// =========================================================================
// queue manager — rathole owns the queue. rodio is treated as a
// single-track player: every track switch is a fresh
// `PlayerCmd::Load(vec![path])` against the row at `m.current`.
// see docs/architecture-decisions for the rationale; the short
// version is that rodio's internal queue made remove/reorder/
// skip-forward operations require multi-thread coordination, and
// also amplified rodio 0.20's per-file panic blast radius
// (preloading 184 tracks = 184 chances to hit the m4a init bug).
// =========================================================================

/// load and play the track at `m.queue[idx]`. clears any prior
/// position state, sets `current = Some(idx)` and `state = Loading`,
/// then spawns a path-resolution task that issues a single-element
/// `PlayerCmd::Load`. on resolve failure the task emits a
/// `MusicEvent::Error` followed by `MusicEvent::Ended` so the auto-
/// advance handler will skip past the broken row.
fn play_index(app: &mut App, idx: usize, tx: &mpsc::UnboundedSender<AppAction>) {
    let m = &mut app.state.ephemeral.music;
    if idx >= m.queue.len() {
        // ran off the end of the queue. mirror what
        // MusicEvent::Ended would do.
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

    let Some(player) = app.player.clone() else {
        m.last_event_error = Some("no audio backend in this shell".to_string());
        return;
    };
    let title = row.title.clone();
    let tx = tx.clone();
    tokio::task::spawn_local(async move {
        let Some(path) = resolve_playable_path(&row).await else {
            let _ = tx.send(AppAction::MusicEvent(
                crate::ratcore::app::MusicEvent::Error(format!(
                    "no playable file for {title} (skipping)"
                )),
            ));
            // synthesize Ended so the auto-advance loop steps past
            // this row instead of stalling on it.
            let _ = tx.send(AppAction::MusicEvent(
                crate::ratcore::app::MusicEvent::Ended,
            ));
            return;
        };
        if let Err(e) = player
            .send(crate::ratcore::transport::PlayerCmd::Load(vec![path]))
            .await
        {
            let _ = tx.send(AppAction::MusicEvent(
                crate::ratcore::app::MusicEvent::Error(e),
            ));
        }
    });
}

/// advance to the next track in the local queue, if any. drives
/// both the `n` key and the `MusicEvent::Ended` auto-advance path.
fn play_next(app: &mut App, tx: &mpsc::UnboundedSender<AppAction>) {
    let next = app
        .state
        .ephemeral
        .music
        .current
        .map(|c| c + 1)
        .unwrap_or(0);
    play_index(app, next, tx);
}

/// step back one track in the local queue. clamps at 0; if nothing
/// is playing yet, plays the first row.
fn play_previous(app: &mut App, tx: &mpsc::UnboundedSender<AppAction>) {
    let prev = app
        .state
        .ephemeral
        .music
        .current
        .map(|c| c.saturating_sub(1))
        .unwrap_or(0);
    play_index(app, prev, tx);
}

/// replace the queue with `songs` and start playing from `start`.
fn play_now(
    app: &mut App,
    songs: Vec<crate::ratcore::app::SongRow>,
    start: usize,
    tx: &mpsc::UnboundedSender<AppAction>,
) {
    app.state.ephemeral.music.queue = songs;
    play_index(app, start, tx);
}

/// append `songs` to the end of the queue. if nothing is currently
/// loaded, starts playback at the first appended row.
fn enqueue_now(
    app: &mut App,
    songs: Vec<crate::ratcore::app::SongRow>,
    tx: &mpsc::UnboundedSender<AppAction>,
) {
    if songs.is_empty() {
        return;
    }
    let m = &mut app.state.ephemeral.music;
    let was_empty_or_idle = m.current.is_none();
    let start = m.queue.len();
    m.queue.extend(songs);
    if was_empty_or_idle {
        play_index(app, start, tx);
    }
}

/// resolve a row's playable file path (local_path or media_blob).
/// also filters out file extensions known to crash rodio 0.20's
/// symphonia adapter on init seek (currently `.m4a`).
async fn resolve_playable_path(s: &crate::ratcore::app::SongRow) -> Option<String> {
    let candidate = if let Some(p) = s.local_path.clone() {
        Some(p)
    } else if let Some(blob_id) = s.media_blob_id.as_deref() {
        super::player::resolve_paths(&[blob_id.to_string()])
            .await
            .into_iter()
            .next()
    } else {
        None
    };
    let path = candidate?;
    if is_known_unplayable(&path) {
        tracing::warn!(
            target: "rathole::tty::player",
            path = %path,
            "skipping unplayable file (known rodio/symphonia panic on init seek)"
        );
        return None;
    }
    Some(path)
}

/// extension-based blocklist. rodio 0.20 + symphonia's m4a demuxer
/// hits `unreachable!("Seek errors should not occur during init")`
/// on a meaningful fraction of real-world files; we'd rather skip
/// them than spam the panic hook.
fn is_known_unplayable(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    lower.ends_with(".m4a")
}

/// play just the row under the cursor. queue is replaced with a
/// single-element vec so subsequent Next/Previous behave as
/// expected (no auto-advance into other library rows).
fn play_one_at_cursor(app: &mut App, tx: &mpsc::UnboundedSender<AppAction>) {
    let m = &app.state.ephemeral.music;
    if m.results.is_empty() {
        return;
    }
    let idx = m.results_cursor.min(m.results.len() - 1);
    let row = m.results[idx].clone();
    play_now(app, vec![row], 0, tx);
}

/// play the row under the cursor and queue everything after it.
/// bound to shift-A in the music view.
fn play_from_cursor(app: &mut App, tx: &mpsc::UnboundedSender<AppAction>) {
    let m = &app.state.ephemeral.music;
    if m.results.is_empty() {
        return;
    }
    let start = m.results_cursor.min(m.results.len() - 1);
    let queue: Vec<crate::ratcore::app::SongRow> = m.results[start..].to_vec();
    play_now(app, queue, 0, tx);
}

fn send_player(
    app: &App,
    cmd: crate::ratcore::transport::PlayerCmd,
    tx: &mpsc::UnboundedSender<AppAction>,
) {
    let Some(player) = app.player.clone() else {
        return;
    };
    let tx = tx.clone();
    tokio::task::spawn_local(async move {
        if let Err(e) = player.send(cmd).await {
            let _ = tx.send(AppAction::MusicEvent(
                crate::ratcore::app::MusicEvent::Error(e),
            ));
        }
    });
}

/// fetch playlist or album songs via transport, then replace the
/// queue and start playing from the first track. resolution +
/// loading happens lazily per-track via `play_index`, so a 200-row
/// album doesn't preload 200 decoders.
fn play_collection(
    app: &mut App,
    kind: &'static str,
    id: String,
    title: String,
    tx: &mpsc::UnboundedSender<AppAction>,
) {
    app.state.ephemeral.repl.status = Some(crate::ratcore::app::ReplStatus::info(format!(
        "loading {kind} {title}\u{2026}"
    )));
    let transport = app.transport.clone();
    let tx_outer = tx.clone();
    let title_for_event = title.clone();
    tokio::task::spawn_local(async move {
        let songs_result = match kind {
            "playlist" => transport.playlist_songs(&id).await,
            "album" => transport.album_songs(&id).await,
            other => Err(format!("unknown collection kind: {other}")),
        };
        let songs = match songs_result {
            Ok(s) => s,
            Err(e) => {
                let _ = tx_outer.send(AppAction::MusicEvent(
                    crate::ratcore::app::MusicEvent::Error(format!("load {kind} failed: {e}")),
                ));
                return;
            }
        };
        if songs.is_empty() {
            let _ = tx_outer.send(AppAction::MusicEvent(
                crate::ratcore::app::MusicEvent::Error(format!(
                    "{kind} {title_for_event} is empty"
                )),
            ));
            return;
        }
        let _ = tx_outer.send(AppAction::CollectionLoaded { songs });
    });
    // mirror the queue locally so the player row reflects what's
    // about to play. the actual song rows arrive via the
    // CollectionLoaded action which calls play_now.
    let m = &mut app.state.ephemeral.music;
    m.queue.clear();
    m.current = None;
    m.position_ms = 0;
    m.duration_ms = 0;
}

/// fetch playlist or album songs and append them to the existing
/// queue without interrupting the currently-playing track. queue
/// extension is rathole-side; the audio thread is unaffected.
fn enqueue_collection(
    app: &mut App,
    kind: &'static str,
    id: String,
    title: String,
    tx: &mpsc::UnboundedSender<AppAction>,
) {
    app.state.ephemeral.repl.status = Some(crate::ratcore::app::ReplStatus::info(format!(
        "queueing {kind} {title}\u{2026}"
    )));
    let transport = app.transport.clone();
    let tx_outer = tx.clone();
    let title_for_event = title.clone();
    tokio::task::spawn_local(async move {
        let songs_result = match kind {
            "playlist" => transport.playlist_songs(&id).await,
            "album" => transport.album_songs(&id).await,
            other => Err(format!("unknown collection kind: {other}")),
        };
        let songs = match songs_result {
            Ok(s) => s,
            Err(e) => {
                let _ = tx_outer.send(AppAction::MusicEvent(
                    crate::ratcore::app::MusicEvent::Error(format!("queue {kind} failed: {e}")),
                ));
                return;
            }
        };
        if songs.is_empty() {
            let _ = tx_outer.send(AppAction::MusicEvent(
                crate::ratcore::app::MusicEvent::Error(format!(
                    "{kind} {title_for_event} is empty"
                )),
            ));
            return;
        }
        let _ = tx_outer.send(AppAction::CollectionEnqueued { songs });
    });
}

/// resolve a song row (looked up by title via the search index) and
/// append it to the queue. used by the per-row "add to queue" action
/// when the row is a single song. matches `play_song` semantics by
/// re-searching the title and using the top hit.
fn enqueue_song_by_title(app: &mut App, title: String, tx: &mpsc::UnboundedSender<AppAction>) {
    if title.is_empty() {
        return;
    }
    app.state.ephemeral.repl.status = Some(crate::ratcore::app::ReplStatus::info(format!(
        "queueing {title}\u{2026}"
    )));
    let transport = app.transport.clone();
    let tx_outer = tx.clone();
    tokio::task::spawn_local(async move {
        let songs = match transport.search_songs(&title, 1).await {
            Ok(rows) => rows,
            Err(e) => {
                let _ = tx_outer.send(AppAction::MusicEvent(
                    crate::ratcore::app::MusicEvent::Error(format!("queue search failed: {e}")),
                ));
                return;
            }
        };
        let Some(song) = songs.into_iter().next() else {
            let _ = tx_outer.send(AppAction::MusicEvent(
                crate::ratcore::app::MusicEvent::Error(format!("no match for {title}")),
            ));
            return;
        };
        let _ = tx_outer.send(AppAction::CollectionEnqueued { songs: vec![song] });
    });
}

/// fire a library_query and route the result through the same
/// AdminDispatchResult channel the slash repl uses, so the result
/// panel renders it identically. used by the "go to album" / "go to
/// artist" row actions to pivot without typing the slash command.
#[allow(dead_code)]
fn fire_library_query(
    app: &App,
    kind: &'static str,
    query: Option<String>,
    tx: &mpsc::UnboundedSender<AppAction>,
) {
    let label = match kind {
        "favorites" => "library_favorites".to_string(),
        "radio" => "radio_stations_list".to_string(),
        _ => format!("library_{kind}"),
    };
    let transport = app.transport.clone();
    let tx = tx.clone();
    tokio::task::spawn_local(async move {
        let response = transport.library_query(kind, query.as_deref()).await;
        let _ = tx.send(AppAction::AdminDispatchResult {
            command: label,
            response,
        });
    });
}

/// fire a library_by_id query (songs of an album, albums of an
/// artist) and route through `AdminDispatchResult`. used by the
/// "go to album" / "go to artist" row actions for deterministic
/// id-based pivots.
fn fire_library_by_id(
    app: &App,
    kind: &'static str,
    parent_field: &'static str,
    parent_id: String,
    tx: &mpsc::UnboundedSender<AppAction>,
) {
    let label = format!("library_{kind}_by_{parent_field}");
    let transport = app.transport.clone();
    let tx = tx.clone();
    tokio::task::spawn_local(async move {
        let response = transport
            .library_by_id(kind, parent_field, &parent_id)
            .await;
        let _ = tx.send(AppAction::AdminDispatchResult {
            command: label,
            response,
        });
    });
}

/// resolve a row's parent ids (album_id, artist_id) via the
/// transport then fire the matching library_by_id pivot. used as a
/// fallback for unified-search rows that don't carry the parent ids
/// inline. `row_kind` is `"song"` or `"album"` (the row's own type),
/// `row_id` is its id; `want_album` selects which target.
fn resolve_then_goto(
    app: &App,
    row_kind: String,
    row_id: String,
    want_album: bool,
    tx: &mpsc::UnboundedSender<AppAction>,
) {
    let transport = app.transport.clone();
    let tx_a = tx.clone();
    tokio::task::spawn_local(async move {
        match transport.resolve_parent_ids(&row_kind, &row_id).await {
            Ok((album_id, artist_id)) => {
                let (kind, parent_field, pid) = if want_album {
                    ("song", "album_id", album_id)
                } else {
                    ("album", "artist_id", artist_id)
                };
                let Some(pid) = pid.filter(|s| !s.is_empty()) else {
                    let label = if want_album { "album" } else { "artist" };
                    let _ = tx_a.send(AppAction::AdminDispatchResult {
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
                let _ = tx_a.send(AppAction::AdminDispatchResult {
                    command: label,
                    response,
                });
            }
            Err(msg) => {
                let _ = tx_a.send(AppAction::AdminDispatchResult {
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

/// apply a queue-management action triggered from the result-panel
/// action menu when the source command is the synthesized `queue`
/// panel. mutates the local queue + reissues `PlayerCmd::Load` to
/// keep the rodio sink in sync. position is the row's `position`
/// field as captured by the repl_keys queue synthesizer.
fn handle_queue_action(
    app: &mut App,
    sentinel: &str,
    position: Option<usize>,
    tx: &mpsc::UnboundedSender<AppAction>,
) {
    use crate::ratcore::transport::PlayerCmd;
    let m = &mut app.state.ephemeral.music;
    let len = m.queue.len();
    if sentinel == "__queue_clear__" {
        send_player(app, PlayerCmd::Stop, tx);
        let m = &mut app.state.ephemeral.music;
        m.queue.clear();
        m.current = None;
        m.queue_resolving = 0;
        m.position_ms = 0;
        m.duration_ms = 0;
        app.state.ephemeral.last_dispatch = None;
        app.state.ephemeral.repl.status =
            Some(crate::ratcore::app::ReplStatus::ok("queue cleared"));
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
            // re-queue starting from `pos` so rodio's sink replays
            // from the requested track. preserves the rest of the
            // queue order. local_path/blob_id resolution mirrors
            // play_collection's path-collect step.
            requeue_from(app, pos, tx);
        }
        "__queue_remove__" => {
            let m = &mut app.state.ephemeral.music;
            let was_current = m.current == Some(pos);
            m.queue.remove(pos);
            // adjust current after removal:
            // - removed before current: shift current down by 1
            // - removed at current: keep index (now points at next
            //   track, unless we ran off the end)
            // - removed after current: nothing to do
            if let Some(c) = m.current {
                if pos < c {
                    m.current = Some(c - 1);
                } else if pos == c {
                    if c >= m.queue.len() {
                        m.current = if m.queue.is_empty() { None } else { Some(0) };
                    }
                }
            }
            let new_len = m.queue.len();
            if new_len == 0 {
                send_player(app, PlayerCmd::Stop, tx);
                app.state.ephemeral.repl.status =
                    Some(crate::ratcore::app::ReplStatus::ok("queue cleared"));
            } else {
                let start = app.state.ephemeral.music.current.unwrap_or(0);
                if was_current {
                    requeue_from(app, start, tx);
                }
                // re-render the /queue panel so the result rows
                // reflect the new positions.
                rerender_queue(app);
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
            rerender_queue(app);
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
            rerender_queue(app);
        }
        _ => {}
    }
}

/// re-render the synthesized `/queue` last_dispatch panel so the
/// rows reflect any local mutations (remove / reorder). preserves
/// the cursor position (clamped to the new length).
fn rerender_queue(app: &mut App) {
    let cur = app
        .state
        .ephemeral
        .last_dispatch
        .as_ref()
        .map(|ld| ld.cursor)
        .unwrap_or(0);
    crate::ratcore::repl_keys::render_queue_panel(&mut app.state, Some(cur));
}

/// rebuild playback starting at `start` index of the existing
/// queue. preserves the queue contents; just (re)plays the chosen
/// row. used by jump-to-track and after removing the currently-
/// playing track.
fn requeue_from(app: &mut App, start: usize, tx: &mpsc::UnboundedSender<AppAction>) {
    play_index(app, start, tx);
}

fn adjust_volume(app: &mut App, delta: f32, tx: &mpsc::UnboundedSender<AppAction>) {
    let new = (app.state.ephemeral.music.volume + delta).clamp(0.0, 2.0);
    app.state.ephemeral.music.volume = new;
    send_player(
        app,
        crate::ratcore::transport::PlayerCmd::SetVolume(new),
        tx,
    );
}

fn on_player_row_key(app: &mut App, code: KeyCode, tx: &mpsc::UnboundedSender<AppAction>) {
    use crate::ratcore::app::PlayerState;
    use crate::ratcore::player_row_keys as prk;
    use crate::ratcore::transport::PlayerCmd;
    match code {
        KeyCode::Esc => prk::leave(&mut app.state),
        KeyCode::Left | KeyCode::Char('h') => prk::cursor_left(&mut app.state),
        KeyCode::Right | KeyCode::Char('l') => prk::cursor_right(&mut app.state),
        KeyCode::Tab => prk::tab_or_leave(&mut app.state),
        KeyCode::BackTab => prk::back_tab_or_leave(&mut app.state),
        // 'f' is a shortcut for the heart-control regardless of which
        // control the cursor is on, so it works the same whether the
        // user navigated to the heart or not.
        KeyCode::Char('f') => {
            if let Some(cur) = app.state.ephemeral.music.currently_playing() {
                let id = cur.id.clone();
                let _ = tx.send(AppAction::ToggleFavorite {
                    target_type: "song".into(),
                    target_id: id,
                });
            } else {
                app.state.ephemeral.repl.status =
                    Some(crate::ratcore::app::ReplStatus::info("no track loaded"));
            }
        }
        KeyCode::Enter | KeyCode::Char(' ') => {
            let action = prk::activate(&app.state);
            match action {
                prk::PlayerRowAction::Previous => play_previous(app, tx),
                prk::PlayerRowAction::PlayPause => match app.state.ephemeral.music.player_state {
                    PlayerState::Playing => send_player(app, PlayerCmd::Pause, tx),
                    _ => send_player(app, PlayerCmd::Play, tx),
                },
                prk::PlayerRowAction::Next => play_next(app, tx),
                prk::PlayerRowAction::SeekBack => {
                    let pos = app.state.ephemeral.music.position_ms;
                    let target = pos.saturating_sub(15_000);
                    send_player(app, PlayerCmd::Seek(target), tx);
                }
                prk::PlayerRowAction::SeekForward => {
                    let pos = app.state.ephemeral.music.position_ms;
                    let total = app.state.ephemeral.music.duration_ms;
                    let target = (pos + 15_000).min(total.max(pos));
                    send_player(app, PlayerCmd::Seek(target), tx);
                }
                prk::PlayerRowAction::VolumeDown => {
                    let v = (app.state.ephemeral.music.volume - 0.05).clamp(0.0, 2.0);
                    app.state.ephemeral.music.volume = v;
                    send_player(app, PlayerCmd::SetVolume(v), tx);
                }
                prk::PlayerRowAction::VolumeUp => {
                    let v = (app.state.ephemeral.music.volume + 0.05).clamp(0.0, 2.0);
                    app.state.ephemeral.music.volume = v;
                    send_player(app, PlayerCmd::SetVolume(v), tx);
                }
                prk::PlayerRowAction::Favorite => {
                    if let Some(cur) = app.state.ephemeral.music.currently_playing() {
                        let id = cur.id.clone();
                        let _ = tx.send(AppAction::ToggleFavorite {
                            target_type: "song".into(),
                            target_id: id,
                        });
                    } else {
                        app.state.ephemeral.repl.status =
                            Some(crate::ratcore::app::ReplStatus::info("no track loaded"));
                    }
                }
            }
        }
        _ => {}
    }
}

fn on_repl_key(
    app: &mut App,
    code: KeyCode,
    _mods: KeyModifiers,
    tx: &mpsc::UnboundedSender<AppAction>,
) {
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
            if let rk::ReplOutcome::Run(act) = outcome {
                execute_slash_with_player(app, act, tx);
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
        KeyCode::Char(c) => rk::insert_char(&mut app.state, c),
        _ => {}
    }
}

/// run a slash action that needs the tty's audio player (rodio) or
/// transport (search). called by `on_repl_key` when
/// [`apply_navigation`] returns `Run(_)`.
fn execute_slash_with_player(
    app: &mut App,
    action: crate::ratcore::slash::SlashAction,
    tx: &mpsc::UnboundedSender<AppAction>,
) {
    use crate::ratcore::app::{MusicMode, ReplStatus};
    use crate::ratcore::repl_keys as rk;
    use crate::ratcore::slash::match_station_id;
    use crate::ratcore::slash::SlashAction;
    use crate::ratcore::transport::PlayerCmd;

    match action {
        SlashAction::Search { query } => {
            app.state.ephemeral.repl.clear_input();
            rk::leave(&mut app.state);
            if let Some(q) = query {
                // unified FTS-ranked search across songs/albums/artists/playlists.
                // results land in the result panel so we can show
                // tagged rows like `[song] title — artist`.
                let transport = app.transport.clone();
                let tx_clone = tx.clone();
                let qc = q.clone();
                tokio::task::spawn_local(async move {
                    let response = transport.unified_search(&qc).await;
                    let _ = tx_clone.send(AppAction::AdminDispatchResult {
                        command: "search".to_string(),
                        response,
                    });
                });
                app.state.ephemeral.repl.status =
                    Some(ReplStatus::info(format!("searching {q}\u{2026}")));
                app.state.ephemeral.focus = Focus::ResultPanel;
            } else {
                app.state.ephemeral.focus = Focus::MusicView;
                app.state.ephemeral.music.mode = MusicMode::Results;
                app.state.ephemeral.repl.status = Some(ReplStatus::info("type to search music"));
            }
        }
        SlashAction::Play { query } => match query {
            Some(q) => {
                app.state.ephemeral.repl.clear_input();
                rk::leave(&mut app.state);
                app.state.ephemeral.focus = Focus::MusicView;
                app.state.ephemeral.music.mode = MusicMode::Results;
                app.state.ephemeral.music.query = q;
                app.state.ephemeral.music.query_cursor =
                    app.state.ephemeral.music.query.chars().count();
                app.state.ephemeral.music.auto_play_on_results = true;
                fire_search(app, tx);
                app.state.ephemeral.repl.status = Some(ReplStatus::info("searching…"));
            }
            None => {
                send_player(app, PlayerCmd::Play, tx);
                app.state.ephemeral.repl.status = Some(ReplStatus::ok("play"));
                app.state.ephemeral.repl.clear_input();
                rk::leave(&mut app.state);
            }
        },
        SlashAction::Pause => {
            send_player(app, PlayerCmd::Pause, tx);
            app.state.ephemeral.repl.status = Some(ReplStatus::ok("pause"));
            app.state.ephemeral.repl.clear_input();
            rk::leave(&mut app.state);
        }
        SlashAction::Stop => {
            send_player(app, PlayerCmd::Stop, tx);
            app.state.ephemeral.repl.status = Some(ReplStatus::ok("stop"));
            app.state.ephemeral.repl.clear_input();
            rk::leave(&mut app.state);
        }
        SlashAction::ClearQueue => {
            // stop also clears grimoire's internal queue. mirror in
            // local state so the music view + queue panel reflect
            // the cleared queue immediately.
            send_player(app, PlayerCmd::Stop, tx);
            let m = &mut app.state.ephemeral.music;
            m.queue.clear();
            m.current = None;
            m.queue_resolving = 0;
            m.position_ms = 0;
            m.duration_ms = 0;
            app.state.ephemeral.repl.status = Some(ReplStatus::ok("queue cleared"));
            app.state.ephemeral.repl.clear_input();
            rk::leave(&mut app.state);
        }
        SlashAction::Next => {
            play_next(app, tx);
            app.state.ephemeral.repl.status = Some(ReplStatus::ok("next"));
            app.state.ephemeral.repl.clear_input();
            rk::leave(&mut app.state);
        }
        SlashAction::Previous => {
            play_previous(app, tx);
            app.state.ephemeral.repl.status = Some(ReplStatus::ok("previous"));
            app.state.ephemeral.repl.clear_input();
            rk::leave(&mut app.state);
        }
        SlashAction::Seek { seconds } => {
            send_player(app, PlayerCmd::Seek(seconds * 1000), tx);
            app.state.ephemeral.repl.status = Some(ReplStatus::ok(format!("seek {seconds}s")));
            app.state.ephemeral.repl.clear_input();
            rk::leave(&mut app.state);
        }
        SlashAction::Volume { percent } => {
            let v = ((percent as f32) / 100.0).clamp(0.0, 2.0);
            app.state.ephemeral.music.volume = v;
            send_player(app, PlayerCmd::SetVolume(v), tx);
            app.state.ephemeral.repl.status = Some(ReplStatus::ok(format!("vol {percent}%")));
            app.state.ephemeral.repl.clear_input();
            rk::leave(&mut app.state);
        }
        SlashAction::Library { kind, query } => {
            // synthesize an admin-dispatch-shaped result. command name
            // gets prefixed so the result panel labels it nicely.
            let label = match kind {
                "favorites" => "library_favorites".to_string(),
                "radio" => "radio_stations_list".to_string(),
                _ => format!("library_{kind}"),
            };
            let transport = app.transport.clone();
            let tx_clone = tx.clone();
            let q = query.clone();
            tokio::task::spawn_local(async move {
                let response = transport.library_query(kind, q.as_deref()).await;
                // special: `/radio <name>` with a query that matches a
                // station starts that station instead of just listing.
                if kind == "radio" && q.is_some() && response.success {
                    if let Some(station_id) = match_station_id(&response.data, q.as_deref()) {
                        let start_resp = transport
                            .admin_dispatch(
                                "radio_supervisor_start",
                                serde_json::json!({ "station_id": station_id }),
                            )
                            .await;
                        let _ = tx_clone.send(AppAction::AdminDispatchResult {
                            command: "radio_supervisor_start".to_string(),
                            response: start_resp,
                        });
                        return;
                    }
                }
                let _ = tx_clone.send(AppAction::AdminDispatchResult {
                    command: label,
                    response,
                });
            });
            app.state.ephemeral.repl.status =
                Some(ReplStatus::info(format!("loading {kind}\u{2026}")));
            app.state.ephemeral.repl.clear_input();
            rk::leave(&mut app.state);
            // surface the result panel so the rows show up.
            app.state.ephemeral.focus = Focus::ResultPanel;
        }
        // pure-state actions are handled inside apply_navigation.
        SlashAction::Local => {
            app.state.ephemeral.repl.clear_input();
            rk::leave(&mut app.state);
            app.state.ephemeral.focus = Focus::MusicView;
            app.state.ephemeral.music.mode = MusicMode::Results;
            app.state.ephemeral.music.searching = true;
            app.state.ephemeral.music.search_error = None;
            app.state.ephemeral.repl.status = Some(ReplStatus::info("loading local songs…"));
            let transport = app.transport.clone();
            let tx_clone = tx.clone();
            tokio::task::spawn_local(async move {
                let result = transport.list_local_songs(200).await;
                let _ = tx_clone.send(AppAction::MusicSearchResults {
                    query: String::new(),
                    result,
                });
            });
        }
        SlashAction::ServeStart { kind } => {
            use crate::ratcore::app::ServeKindRequest;
            use crate::ratcore::slash::ServeKindArg;
            let mapped = match kind {
                ServeKindArg::Auto => ServeKindRequest::Auto,
                ServeKindArg::Http => ServeKindRequest::Http,
                ServeKindArg::P2p => ServeKindRequest::P2p,
            };
            let _ = tx.send(AppAction::ServeStart { kind: mapped });
            app.state.ephemeral.repl.clear_input();
            rk::leave(&mut app.state);
        }
        SlashAction::ServeStop => {
            let _ = tx.send(AppAction::ServeStop);
            app.state.ephemeral.repl.clear_input();
            rk::leave(&mut app.state);
        }
        SlashAction::AdminDispatch { name, body } => {
            // generic admin-rpc dispatch from /knock /users /analytics
            // /radio subcommands. result lands in the result panel
            // like any other admin call.
            spawn_admin_dispatch(app, name, body, tx);
            app.state.ephemeral.repl.status =
                Some(ReplStatus::info(format!("dispatching {name}\u{2026}")));
            app.state.ephemeral.repl.clear_input();
            rk::leave(&mut app.state);
            app.state.ephemeral.focus = Focus::ResultPanel;
        }
        _ => {}
    }
}

/// load the most-recently-active remote's `peer_addr` from grimoire's
/// remotez table, if any. used at boot to pre-seed the header.
async fn load_recent_peer() -> Option<String> {
    let repo = grimoire::remotez::RemoteRepository::new();
    let remotes = match repo.list().await {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!("rathole: remotez list failed: {e}");
            return None;
        }
    };
    // list() is ordered by updated_at DESC, so the first row is also
    // the most-recently-touched. prefer the active row when present.
    remotes
        .iter()
        .find(|r| r.is_active)
        .or_else(|| remotes.first())
        .and_then(|r| r.peer_addr.clone())
}

/// upsert a peer_addr into grimoire's remotez table. fire-and-forget
/// from a tokio::task::spawn_local — failures are logged but never
/// surface to the user.
fn persist_peer_addr(addr: String) {
    tokio::task::spawn_local(async move {
        let repo = grimoire::remotez::RemoteRepository::new();
        // remote_id derived from the addr keeps upsert idempotent.
        let remote_id = format!("rathole:{}", addr);
        let req = grimoire::remotez::UpsertRemoteRequest {
            remote_id,
            name: addr.clone(),
            transport: grimoire::remotez::RemoteTransport::App,
            base_url: None,
            peer_addr: Some(addr),
            api_key: None,
            is_active: Some(true),
            is_charnel_managed: None,
            last_connected_at: Some(now_unix_secs()),
            description: None,
            image_url: None,
            image_blob_id: None,
            version: None,
            last_info_check: None,
            is_offline: Some(false),
            offline_since: None,
            last_checked: None,
            metadata: None,
        };
        if let Err(e) = repo.upsert(&req).await {
            tracing::warn!("rathole: remotez upsert failed: {e}");
        }
    });
}

fn now_unix_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// switch focus to the remotes-list view and kick off an async load
/// from grimoire's `remotez` table. the loader sends the result back
/// via [`AppAction::RemotesLoaded`].
#[allow(dead_code)]
fn open_remote_list_tty(app: &mut App, action_tx: &mpsc::UnboundedSender<AppAction>) {
    app.state.ephemeral.focus = Focus::RemoteList;
    app.state.ephemeral.remotes_view_cursor = 0;
    spawn_remotes_reload(action_tx);
}

/// fire a fresh load of grimoire's `remotez` table and post the
/// mapped entries back as [`AppAction::RemotesLoaded`].
#[allow(dead_code)]
fn spawn_remotes_reload(action_tx: &mpsc::UnboundedSender<AppAction>) {
    let tx = action_tx.clone();
    tokio::task::spawn_local(async move {
        let repo = grimoire::remotez::RemoteRepository::new();
        let remotes = match repo.list().await {
            Ok(r) => r,
            Err(e) => {
                tracing::warn!("rathole: remotez list failed: {e}");
                Vec::new()
            }
        };
        let entries = remotes
            .into_iter()
            .map(|r| crate::ratcore::app::RemoteEntry {
                remote_id: r.remote_id,
                name: r.name,
                transport: match r.transport {
                    grimoire::remotez::RemoteTransport::App => "app".to_string(),
                    grimoire::remotez::RemoteTransport::Http => "http".to_string(),
                    grimoire::remotez::RemoteTransport::Wasm => "wasm".to_string(),
                },
                peer_addr: r.peer_addr,
                base_url: r.base_url,
                is_active: r.is_active,
                last_connected_at: r.last_connected_at,
                local_ref: None,
            })
            .collect::<Vec<_>>();
        let _ = tx.send(AppAction::RemotesLoaded { remotes: entries });
    });
}

/// keys for the [`Focus::RemoteList`] modal in the tty shell. tty
/// remotes are persisted in grimoire's `remotez` table, so all
/// mutations round-trip through [`grimoire::remotez::RemoteRepository`].
fn on_remote_list_key_tty(
    app: &mut App,
    code: KeyCode,
    action_tx: &mpsc::UnboundedSender<AppAction>,
) {
    match code {
        KeyCode::Esc => {
            app.state.ephemeral.focus = Focus::Landing;
        }
        KeyCode::Down => {
            let len = app.state.ephemeral.remotes_view.len();
            if len > 0 {
                let next = (app.state.ephemeral.remotes_view_cursor + 1).min(len - 1);
                app.state.ephemeral.remotes_view_cursor = next;
            }
        }
        KeyCode::Up => {
            app.state.ephemeral.remotes_view_cursor =
                app.state.ephemeral.remotes_view_cursor.saturating_sub(1);
        }
        KeyCode::Char('a') => {
            // open the peer-input modal so the user can paste an
            // iroh peer addr; on submit the existing tty connect
            // path will upsert it via `persist_peer_addr`.
            app.state.ephemeral.peer_input.clear();
            app.state.ephemeral.peer_cursor = 0;
            app.state.ephemeral.peer_error = None;
            app.state.ephemeral.focus = Focus::PeerInput;
        }
        KeyCode::Char('d') => {
            let cursor = app.state.ephemeral.remotes_view_cursor;
            let remote_id = app
                .state
                .ephemeral
                .remotes_view
                .get(cursor)
                .map(|r| r.remote_id.clone());
            if let Some(remote_id) = remote_id {
                let tx_inner = action_tx.clone();
                tokio::task::spawn_local(async move {
                    let repo = grimoire::remotez::RemoteRepository::new();
                    if let Err(e) = repo.remove(&remote_id).await {
                        tracing::warn!("rathole: remotez remove failed: {e}");
                    }
                    // reload after the delete completes.
                    let remotes = repo.list().await.unwrap_or_default();
                    let entries = remotes
                        .into_iter()
                        .map(|r| crate::ratcore::app::RemoteEntry {
                            remote_id: r.remote_id,
                            name: r.name,
                            transport: match r.transport {
                                grimoire::remotez::RemoteTransport::App => "app".to_string(),
                                grimoire::remotez::RemoteTransport::Http => "http".to_string(),
                                grimoire::remotez::RemoteTransport::Wasm => "wasm".to_string(),
                            },
                            peer_addr: r.peer_addr,
                            base_url: r.base_url,
                            is_active: r.is_active,
                            last_connected_at: r.last_connected_at,
                            local_ref: None,
                        })
                        .collect::<Vec<_>>();
                    let _ = tx_inner.send(AppAction::RemotesLoaded { remotes: entries });
                });
            }
        }
        KeyCode::Enter => {
            // mark the highlighted remote as active and reload.
            // tty doesn't hot-swap transports today, so the only
            // visible effect is the `*` indicator and the next
            // launch picking this peer for `load_recent_peer`.
            let cursor = app.state.ephemeral.remotes_view_cursor;
            let entry = app.state.ephemeral.remotes_view.get(cursor).cloned();
            if let Some(entry) = entry {
                if let Some(addr) = entry.peer_addr.clone() {
                    app.state.ephemeral.connected_peer = Some(addr);
                    app.state.ephemeral.remote_name = Some(entry.name.clone());
                }
                let remote_id = entry.remote_id.clone();
                let tx_inner = action_tx.clone();
                tokio::task::spawn_local(async move {
                    let repo = grimoire::remotez::RemoteRepository::new();
                    if let Err(e) = repo.mark_active(&remote_id).await {
                        tracing::warn!("rathole: remotez mark_active failed: {e}");
                    }
                    let remotes = repo.list().await.unwrap_or_default();
                    let entries = remotes
                        .into_iter()
                        .map(|r| crate::ratcore::app::RemoteEntry {
                            remote_id: r.remote_id,
                            name: r.name,
                            transport: match r.transport {
                                grimoire::remotez::RemoteTransport::App => "app".to_string(),
                                grimoire::remotez::RemoteTransport::Http => "http".to_string(),
                                grimoire::remotez::RemoteTransport::Wasm => "wasm".to_string(),
                            },
                            peer_addr: r.peer_addr,
                            base_url: r.base_url,
                            is_active: r.is_active,
                            last_connected_at: r.last_connected_at,
                            local_ref: None,
                        })
                        .collect::<Vec<_>>();
                    let _ = tx_inner.send(AppAction::RemotesLoaded { remotes: entries });
                });
            }
        }
        _ => {}
    }
}
