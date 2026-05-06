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
    AdminCommand, App, AppAction, AppState, ArgKind, CommandForm, CommandKind, FieldState, Focus,
    LastDispatch, PersistedState, SelectOption,
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
    let (action_tx, mut action_rx) = mpsc::unbounded_channel::<AppAction>();
    let player = super::player::RodioPlayer::spawn(action_tx.clone());
    let mut app = App::new(state, transport, commands).with_player(player);

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
        }
        return;
    }
    let Event::Key(k) = ev else { return };
    if k.kind != KeyEventKind::Press {
        return;
    }

    // global hotkeys first
    match (k.code, k.modifiers) {
        (KeyCode::Char('c'), KeyModifiers::CONTROL) => {
            app.exit = true;
            return;
        }
        // 'q' quits only when not editing text (otherwise you couldn't
        // type 'q' into the peer-input field).
        (KeyCode::Char('q'), _)
            if !matches!(
                app.state.ephemeral.focus,
                Focus::PeerInput | Focus::MusicView
            ) =>
        {
            app.exit = true;
            return;
        }
        _ => {}
    }

    // dispatch to focused area
    match app.state.ephemeral.focus {
        Focus::AdminPalette => on_palette_key(app, k.code, action_tx),
        Focus::PeerInput => on_peer_input_key(app, k.code),
        Focus::CommandForm => on_form_key(app, k.code, k.modifiers, action_tx),
        Focus::ResultPanel => on_result_panel_key(app, k.code, k.modifiers),
        Focus::ResultActionMenu => on_action_menu_key(app, k.code, action_tx),
        Focus::MusicView => on_music_key(app, k.code, action_tx),
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
        KeyCode::Char('p') => {
            // open peer-input modal. tty's LocalTransport doesn't use a
            // peer addr today (m5 will plumb iroh into the tty shell
            // too), so the modal is mostly here for parity with the
            // web shell + uniform paste/edit testing.
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
        KeyCode::Char('m') => {
            app.state.ephemeral.focus = Focus::MusicView;
            app.state.ephemeral.music.mode = crate::ratcore::app::MusicMode::Search;
        }
        KeyCode::Enter => {
            // if the command has args, open the inline form. otherwise
            // dispatch immediately with empty args.
            let cmd = app.commands[selected].clone();
            if !cmd.args.is_empty() {
                app.state.ephemeral.form = Some(CommandForm::new(&cmd));
                app.state.ephemeral.focus = Focus::CommandForm;
                maybe_fetch_select_options(app, action_tx);
                return;
            }
            spawn_admin_dispatch(app, &cmd.name, serde_json::json!({}), action_tx);
        }
        KeyCode::Tab => {
            app.state.ephemeral.focus = Focus::ResultPanel;
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

fn on_action(app: &mut App, action: AppAction) {
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
        AppAction::PeerConnectResult { .. } | AppAction::LocalNodeReady { .. } => {}
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
                }
                Err(e) => {
                    m.search_error = Some(e);
                }
            }
        }
        AppAction::MusicEvent(ev) => apply_music_event(app, ev),
    }
}

fn apply_music_event(app: &mut App, ev: crate::ratcore::app::MusicEvent) {
    use crate::ratcore::app::MusicEvent;
    let m = &mut app.state.ephemeral.music;
    match ev {
        MusicEvent::State(s) => m.player_state = s,
        MusicEvent::Progress { ms, total_ms } => {
            m.position_ms = ms;
            m.duration_ms = total_ms;
        }
        MusicEvent::TrackChanged { index, .. } => {
            m.current = Some(index);
            m.position_ms = 0;
        }
        MusicEvent::Ended => {
            m.current = None;
            m.position_ms = 0;
            m.player_state = crate::ratcore::app::PlayerState::Stopped;
        }
        MusicEvent::Error(e) => m.last_event_error = Some(e),
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
        KeyCode::Esc | KeyCode::Tab => eph.focus = Focus::AdminPalette,
        KeyCode::Up | KeyCode::Char('k') => {
            let step = if big { 10 } else { 1 };
            if has_rows {
                if let Some(ld) = eph.last_dispatch.as_mut() {
                    ld.cursor = ld.cursor.saturating_sub(step as usize);
                }
            } else {
                eph.last_dispatch_scroll = eph.last_dispatch_scroll.saturating_sub(step);
            }
        }
        KeyCode::Down | KeyCode::Char('j') => {
            let step = if big { 10 } else { 1 };
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
            // open the per-row action menu, if there's a row + actions.
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
        // Tab always advances (handy when focused field is a LongText
        // editor where Enter inserts a newline).
        KeyCode::Tab => advance_form(app, tx),
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
            app.state.ephemeral.form =
                Some(crate::ratcore::app::CommandForm::new_with_prefill(&cmd, &row));
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
            app.state.ephemeral.focus = Focus::AdminPalette;
        }
        // global player toggle in either mode if something is playing/paused.
        (MusicMode::Results, KeyCode::Char(' ')) => {
            send_player(app, match app.state.ephemeral.music.player_state {
                PlayerState::Playing => PlayerCmd::Pause,
                _ => PlayerCmd::Play,
            }, tx);
        }
        (MusicMode::Results, KeyCode::Char('n')) => send_player(app, PlayerCmd::Next, tx),
        (MusicMode::Results, KeyCode::Char('p')) => send_player(app, PlayerCmd::Previous, tx),
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
            app.state.ephemeral.music.mode = MusicMode::Search;
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
        (MusicMode::Results, KeyCode::Enter) => play_from_cursor(app, tx),
        (MusicMode::Results, KeyCode::Tab) => {
            app.state.ephemeral.music.mode = MusicMode::Search;
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

fn play_from_cursor(app: &mut App, tx: &mpsc::UnboundedSender<AppAction>) {
    let m = &mut app.state.ephemeral.music;
    if m.results.is_empty() {
        return;
    }
    let start = m.results_cursor.min(m.results.len() - 1);
    let queue: Vec<crate::ratcore::app::SongRow> = m.results[start..].to_vec();
    m.queue = queue.clone();
    m.current = None;
    m.position_ms = 0;
    m.duration_ms = 0;

    let Some(player) = app.player.clone() else {
        m.last_event_error = Some("no audio backend in this shell".to_string());
        return;
    };
    let tx = tx.clone();
    tokio::task::spawn_local(async move {
        let mut paths: Vec<String> = Vec::with_capacity(queue.len());
        for s in &queue {
            if let Some(p) = s.local_path.clone() {
                paths.push(p);
                continue;
            }
            if let Some(blob_id) = s.media_blob_id.as_deref() {
                let resolved = super::player::resolve_paths(&[blob_id.to_string()]).await;
                if let Some(p) = resolved.into_iter().next() {
                    paths.push(p);
                }
            }
        }
        if paths.is_empty() {
            let _ = tx.send(AppAction::MusicEvent(
                crate::ratcore::app::MusicEvent::Error(
                    "no playable files found (no local_path on media_blobz)".to_string(),
                ),
            ));
            return;
        }
        if let Err(e) = player
            .send(crate::ratcore::transport::PlayerCmd::Load(paths))
            .await
        {
            let _ = tx.send(AppAction::MusicEvent(
                crate::ratcore::app::MusicEvent::Error(e),
            ));
        }
    });
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

fn adjust_volume(app: &mut App, delta: f32, tx: &mpsc::UnboundedSender<AppAction>) {
    let new = (app.state.ephemeral.music.volume + delta).clamp(0.0, 2.0);
    app.state.ephemeral.music.volume = new;
    send_player(app, crate::ratcore::transport::PlayerCmd::SetVolume(new), tx);
}
