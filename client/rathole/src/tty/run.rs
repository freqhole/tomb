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
    // bracketed paste arrives as one event for the whole pasted string.
    // route it to the focused field if any.
    if let Event::Paste(text) = ev {
        if matches!(app.state.ephemeral.focus, Focus::PeerInput) {
            use crate::ratcore::text_input as ti;
            let eph = &mut app.state.ephemeral;
            ti::insert_str(&mut eph.peer_input, &mut eph.peer_cursor, &text);
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
        (KeyCode::Char('q'), _) if !matches!(app.state.ephemeral.focus, Focus::PeerInput) => {
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
            app.state.ephemeral.last_dispatch = Some(LastDispatch {
                command,
                success: response.success,
                message: response.message,
                data_pretty,
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
    match code {
        KeyCode::Esc | KeyCode::Tab => eph.focus = Focus::AdminPalette,
        KeyCode::Up | KeyCode::Char('k') => {
            let step = if big { 10 } else { 1 };
            eph.last_dispatch_scroll = eph.last_dispatch_scroll.saturating_sub(step);
        }
        KeyCode::Down | KeyCode::Char('j') => {
            let step = if big { 10 } else { 1 };
            eph.last_dispatch_scroll = eph.last_dispatch_scroll.saturating_add(step);
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
        KeyCode::Enter => advance_form(app, tx),
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
        FieldState::Text { buf, .. } => {
            if buf.trim().is_empty() {
                // optional fields are allowed to be blank; we don't
                // know `required` here so accept and let `build_body`
                // reject required-but-empty at confirm time.
            }
            Ok(())
        }
        FieldState::OneOf { .. } => Ok(()),
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
        FieldState::HiddenLocalNodeId => Ok(()),
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
    let Some(state) = form.fields.get_mut(field_idx) else {
        return;
    };
    let needs_fetch = matches!(
        state,
        FieldState::SelectFrom {
            options: None,
            loading: false,
            ..
        }
    );
    if !needs_fetch {
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
        data_path,
        value_field,
        label_field,
    } = spec.kind
    else {
        return;
    };
    if let FieldState::SelectFrom { loading, error, .. } = state {
        *loading = true;
        *error = None;
    }
    let transport = app.transport.clone();
    let tx = tx.clone();
    tokio::task::spawn_local(async move {
        let response = transport
            .admin_dispatch(&source_command, serde_json::json!({}))
            .await;
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
        out.push(SelectOption { value, label });
    }
    Ok(out)
}
