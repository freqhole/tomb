//! first-run setup wizard. owns its own ratatui terminal and runs a
//! multi-step form, then calls `grimoire::setup::SetupService` to do the
//! actual work (config file + db init + migrations + admin user). after
//! the core setup completes, an optional second step lets the user point
//! at a music directory and watch a live scan/import progress bar.
//!
//! invoked by the cli when `Commands::Rathole` is selected and no
//! `freqhole-config.toml` exists at the resolved path. on success
//! the cli falls through to normal init + tui launch.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use color_eyre::Result;
use crossterm::event::{Event, EventStream, KeyCode, KeyEventKind, KeyModifiers};
use futures::StreamExt;
use grimoire::jobs::{self, job_events::JobEvent, CancellationToken};
use grimoire::setup::{get_local_defaults, SetupConfig, SetupResult, SetupService};
use ratatui::{
    layout::{Constraint, Layout, Rect},
    style::{Color, Style, Stylize},
    text::{Line, Span},
    widgets::{Block, Borders, Gauge, Paragraph, Wrap},
    DefaultTerminal, Frame,
};
use tokio::sync::broadcast;

// ---------------------------------------------------------------------------
// form fields
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, PartialEq, Eq)]
enum FieldId {
    DataDir,
    ServerName,
    Description,
    AdminUsername,
    ImagePath,
    EnableHttp,
    EnableP2p,
    EnableKnocking,
    EnableRemoteAdmin,
    EnableRadio,
    EnableFetchMusic,
}

const FIELDS: &[FieldId] = &[
    FieldId::DataDir,
    FieldId::ServerName,
    FieldId::Description,
    FieldId::AdminUsername,
    FieldId::ImagePath,
    FieldId::EnableHttp,
    FieldId::EnableP2p,
    FieldId::EnableKnocking,
    FieldId::EnableRemoteAdmin,
    FieldId::EnableRadio,
    FieldId::EnableFetchMusic,
];

impl FieldId {
    fn is_path(self) -> bool {
        matches!(self, FieldId::DataDir | FieldId::ImagePath)
    }

    fn is_bool(self) -> bool {
        matches!(
            self,
            FieldId::EnableHttp
                | FieldId::EnableP2p
                | FieldId::EnableKnocking
                | FieldId::EnableRemoteAdmin
                | FieldId::EnableRadio
                | FieldId::EnableFetchMusic
        )
    }

    fn label(self) -> &'static str {
        match self {
            FieldId::DataDir => "data dir       ",
            FieldId::ServerName => "server name    ",
            FieldId::Description => "description    ",
            FieldId::AdminUsername => "admin username ",
            FieldId::ImagePath => "image path     ",
            FieldId::EnableHttp => "http server    ",
            FieldId::EnableP2p => "p2p / federation",
            FieldId::EnableKnocking => "knocking       ",
            FieldId::EnableRemoteAdmin => "remote admin   ",
            FieldId::EnableRadio => "radio          ",
            FieldId::EnableFetchMusic => "fetch music    ",
        }
    }
}

// ---------------------------------------------------------------------------
// status / phase
// ---------------------------------------------------------------------------

enum Status {
    Editing,
    Running,
    Failed(String),
}

/// scan step state. lives only after main setup completes.
struct ScanState {
    music_dir: String,
    tags_csv: String,
    selected_path: bool, // true = path field selected, false = tags field
    /// background scan in flight (Some = scanning, None = not yet started or done)
    handle: Option<ScanHandle>,
    /// latest job-progress snapshot from grimoire events
    progress: Option<ProgressSnapshot>,
    /// latest job-session-complete summary from grimoire events
    completion: Option<CompletionSnapshot>,
    /// final outcome message once done
    finished: Option<String>,
    /// most recent error from scan dispatch
    error: Option<String>,
    /// tab-completion cycle state for music_dir
    path_cycle: Option<CompletionState>,
}

#[derive(Clone)]
struct ProgressSnapshot {
    directory: String,
    songs_added: u32,
    jobs_pending: u32,
    jobs_total: u32,
}

#[derive(Clone)]
struct CompletionSnapshot {
    songs_added: u32,
    albums_added: u32,
    artists_added: u32,
}

struct ScanHandle {
    session_id: String,
    cancel: CancellationToken,
    /// result of the inline scan (file enumeration + job enqueue).
    /// `None` while still walking the fs; `Some(Ok(n))` once we know
    /// how many jobs were created; `Some(Err(msg))` on fs / db error.
    /// the main loop polls this on every tick so the ui can react
    /// when 0 files are found (no events would otherwise fire) or
    /// when scan_directory itself blew up.
    enqueue: Arc<Mutex<Option<std::result::Result<usize, String>>>>,
}

enum Phase {
    Form,
    Scan(ScanState),
    Done,
}

// ---------------------------------------------------------------------------
// app state
// ---------------------------------------------------------------------------

struct WizardApp {
    config_path: PathBuf,
    data_dir: String,
    server_name: String,
    description: String,
    admin_username: String,
    image_path: String,
    /// http server enabled in the generated freqhole-config.toml.
    /// drives both the persisted `[server].enabled` flag and the
    /// rathole tty's autostart-on-launch behavior.
    enable_http: bool,
    /// federation / p2p enabled in the generated config. drives
    /// `[federation].enabled` and tty autostart. defaults to on.
    enable_p2p: bool,
    /// allow unknown peers to "knock" and request access. drives
    /// `[federation].knocking_enabled`. on by default so peers
    /// have a built-in path to request access without out-of-band
    /// invite codes.
    enable_knocking: bool,
    /// enable remote admin over p2p federation.
    enable_remote_admin: bool,
    /// enable radio subsystem.
    enable_radio: bool,
    /// enable server.fetch_music routes.
    enable_fetch_music: bool,
    selected: usize,
    status: Status,
    cancelled: bool,
    setup_result: Option<SetupResult>,
    phase: Phase,
    /// tab-completion cycle state for the form's path fields
    path_cycle: Option<CompletionState>,
}

impl WizardApp {
    fn new(config_path: PathBuf) -> Self {
        let d = get_local_defaults();
        Self {
            config_path,
            data_dir: d.data_dir.display().to_string(),
            server_name: d.server_name,
            description: String::new(),
            admin_username: d.username,
            image_path: String::new(),
            enable_http: false,
            enable_p2p: true,
            enable_knocking: true,
            enable_remote_admin: false,
            enable_radio: false,
            enable_fetch_music: true,
            selected: 0,
            status: Status::Editing,
            cancelled: false,
            setup_result: None,
            phase: Phase::Form,
            path_cycle: None,
        }
    }

    fn current_field(&self) -> FieldId {
        FIELDS[self.selected]
    }

    fn current_buf_mut(&mut self) -> &mut String {
        match self.current_field() {
            FieldId::DataDir => &mut self.data_dir,
            FieldId::ServerName => &mut self.server_name,
            FieldId::Description => &mut self.description,
            FieldId::AdminUsername => &mut self.admin_username,
            FieldId::ImagePath => &mut self.image_path,
            // bool fields have no text buffer; callers must guard
            // with `is_bool()` before invoking this. unreachable
            // here keeps the api ergonomic for the path/text fields.
            FieldId::EnableHttp
            | FieldId::EnableP2p
            | FieldId::EnableKnocking
            | FieldId::EnableRemoteAdmin
            | FieldId::EnableRadio
            | FieldId::EnableFetchMusic => {
                unreachable!("current_buf_mut called on bool field")
            }
        }
    }

    /// toggle the currently-selected boolean field. no-op for
    /// non-bool fields. used by the space-key handler.
    fn toggle_current_bool(&mut self) {
        match self.current_field() {
            FieldId::EnableHttp => self.enable_http = !self.enable_http,
            FieldId::EnableP2p => self.enable_p2p = !self.enable_p2p,
            FieldId::EnableKnocking => self.enable_knocking = !self.enable_knocking,
            FieldId::EnableRemoteAdmin => self.enable_remote_admin = !self.enable_remote_admin,
            FieldId::EnableRadio => self.enable_radio = !self.enable_radio,
            FieldId::EnableFetchMusic => self.enable_fetch_music = !self.enable_fetch_music,
            _ => {}
        }
    }

    fn build_setup_config(&self) -> std::result::Result<SetupConfig, String> {
        let trimmed = self.data_dir.trim();
        if trimmed.is_empty() {
            return Err("data dir is required".into());
        }
        // tilde-expand so users can type shell-style paths. without
        // this, `~/freqhole` ends up as a literal `~/freqhole` in
        // the config and grimoire silently can't find it.
        let data_dir = PathBuf::from(expand_tilde(trimmed));
        let server_name = self.server_name.trim().to_string();
        if server_name.is_empty() {
            return Err("server name is required".into());
        }
        let admin = self.admin_username.trim().to_string();
        let description = {
            let d = self.description.trim();
            if d.is_empty() {
                None
            } else {
                Some(d.to_string())
            }
        };
        // image_path: tilde-expand and verify the file exists up
        // front so the user gets a clear error in the wizard
        // instead of a non-fatal warning during setup that leaves
        // the server with no image. relative paths get resolved
        // against the chosen data_dir (mirrors what grimoire's
        // ensure_server_image_blob does at load time).
        let image_path = {
            let p = self.image_path.trim();
            if p.is_empty() {
                None
            } else {
                let expanded = expand_tilde(p);
                let probe = PathBuf::from(&expanded);
                let probe = if probe.is_absolute() {
                    probe
                } else {
                    data_dir.join(&probe)
                };
                if !probe.is_file() {
                    return Err(format!("image path not found: {}", probe.display()));
                }
                Some(expanded)
            }
        };
        Ok(SetupConfig {
            config_path: self.config_path.clone(),
            data_dir,
            // port left at template/grimoire default
            server_name,
            server_port: 8080,
            description,
            image_path,
            admin_username: if admin.is_empty() { None } else { Some(admin) },
            generate_api_key: true,
            generate_invite_code: false,
            ytdlp_available: false,
            fetch_music_dir: None,
            initial_scan_dirs: Vec::new(),
            allowed_origins: None,
            ffmpeg_path: None,
            ffprobe_path: None,
            ytdlp_path: None,
            server_enabled: Some(self.enable_http),
            federation_enabled: Some(self.enable_p2p),
            knocking_enabled: Some(self.enable_knocking),
            remote_admin_enabled: Some(self.enable_remote_admin),
            radio_enabled: Some(self.enable_radio),
            fetch_music_enabled: Some(self.enable_fetch_music),
        })
    }
}

// ---------------------------------------------------------------------------
// entrypoint
// ---------------------------------------------------------------------------

/// run the setup wizard. owns ratatui's terminal lifecycle (init +
/// restore). on success returns the `SetupResult` so the caller can
/// surface any generated api key / invite code to stderr after the
/// alt-screen tears down.
pub async fn run(config_path: PathBuf) -> Result<SetupResult> {
    let terminal = ratatui::init();
    let result = run_inner(terminal, config_path).await;
    ratatui::restore();
    result
}

async fn run_inner(mut terminal: DefaultTerminal, config_path: PathBuf) -> Result<SetupResult> {
    let mut app = WizardApp::new(config_path);
    let mut input = EventStream::new();
    let mut tick = tokio::time::interval(Duration::from_millis(500));
    // subscribe up-front so we never miss the first progress event after
    // start_scan kicks off (the broadcast channel only delivers events sent
    // *after* subscribe).
    let mut grim_rx = grimoire::jobs::job_events::subscribe();

    loop {
        terminal.draw(|f| draw(f, &app))?;

        if app.cancelled {
            return Err(color_eyre::eyre::eyre!("setup wizard cancelled"));
        }

        if matches!(app.phase, Phase::Done) {
            // wait for any keypress, then return
            if let Some(ev) = input.next().await {
                match ev {
                    Ok(Event::Key(k)) if k.kind == KeyEventKind::Press => {
                        return app
                            .setup_result
                            .ok_or_else(|| color_eyre::eyre::eyre!("missing setup result"));
                    }
                    Err(e) => return Err(color_eyre::eyre::eyre!("input stream error: {e}")),
                    _ => {}
                }
            }
            continue;
        }

        tokio::select! {
            maybe_ev = input.next() => match maybe_ev {
                Some(Ok(Event::Key(k))) if k.kind == KeyEventKind::Press => {
                    handle_key(&mut app, k.code, k.modifiers).await;
                }
                Some(Ok(_)) => {}
                Some(Err(e)) => return Err(color_eyre::eyre::eyre!("input stream error: {e}")),
                None => return Err(color_eyre::eyre::eyre!("input stream closed")),
            },
            grim_ev = grim_rx.recv() => match grim_ev {
                Ok(ev) => apply_grimoire_event(&mut app, ev),
                // lagged: skipped events are fine, the next event still updates us
                Err(broadcast::error::RecvError::Lagged(_)) => {}
                Err(broadcast::error::RecvError::Closed) => {
                    // channel can't really close (static), but be defensive
                    grim_rx = grimoire::jobs::job_events::subscribe();
                }
            },
            _ = tick.tick() => {
                // poll the inline scan-result slot. if scan_directory
                // errored we surface it; if it found 0 files no events
                // would ever fire so we have to finish the phase here.
                check_enqueue_result(&mut app);
            }
        }
    }
}

/// inspect the scanner's enqueue slot. if it's populated with `Err`
/// (fs / db blow-up) or `Ok(0)` (no audio files in the chosen dir),
/// finalize the scan phase manually since the runner won't emit any
/// JobSessionComplete event in either case. consumes the slot so we
/// only fire once.
fn check_enqueue_result(app: &mut WizardApp) {
    let scan = match &mut app.phase {
        Phase::Scan(s) => s,
        _ => return,
    };
    // only act while a scan is in flight and we have no progress yet
    // (once a JobProgress event arrives the runner is alive and will
    // eventually emit JobSessionComplete on its own).
    let handle = match scan.handle.as_ref() {
        Some(h) => h,
        None => return,
    };
    let result = {
        let mut slot = match handle.enqueue.lock() {
            Ok(g) => g,
            Err(_) => return,
        };
        slot.take()
    };
    let Some(result) = result else { return };
    match result {
        Err(msg) => {
            scan.error = Some(format!("scan failed: {msg}"));
            handle.cancel.cancel();
            scan.handle = None;
        }
        Ok(0) => {
            scan.finished = Some("no audio files found in that directory".into());
            handle.cancel.cancel();
            scan.handle = None;
        }
        Ok(_) => {
            // jobs were enqueued; let the runner drive the rest of
            // the lifecycle via JobProgress / JobSessionComplete.
        }
    }
}

fn apply_grimoire_event(app: &mut WizardApp, ev: JobEvent) {
    let scan = match &mut app.phase {
        Phase::Scan(s) => s,
        _ => return,
    };
    let handle = match &scan.handle {
        Some(h) => h,
        None => return,
    };
    match ev {
        JobEvent::Progress {
            session_id,
            details: Some(d),
            ..
        } if session_id == handle.session_id => {
            let directory = d
                .get("directory")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let songs_added = d.get("songs_added").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
            let jobs_pending = d.get("jobs_pending").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
            let jobs_total = d.get("jobs_total").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
            scan.progress = Some(ProgressSnapshot {
                directory,
                songs_added,
                jobs_pending,
                jobs_total,
            });
        }
        JobEvent::Completed {
            session_id,
            details,
            ..
        } if session_id == handle.session_id => {
            let songs_added = details
                .as_ref()
                .and_then(|d| d.get("songs_added"))
                .and_then(|v| v.as_u64())
                .unwrap_or(0) as u32;
            let albums_added = details
                .as_ref()
                .and_then(|d| d.get("albums_added"))
                .and_then(|v| v.as_u64())
                .unwrap_or(0) as u32;
            let artists_added = details
                .as_ref()
                .and_then(|d| d.get("artists_added"))
                .and_then(|v| v.as_u64())
                .unwrap_or(0) as u32;
            scan.completion = Some(CompletionSnapshot {
                songs_added,
                albums_added,
                artists_added,
            });
            scan.finished = Some(format!("scan complete: {} songs imported.", songs_added));
            handle.cancel.cancel();
            scan.handle = None;
        }
        _ => {}
    }
}

// ---------------------------------------------------------------------------
// key handling
// ---------------------------------------------------------------------------

async fn handle_key(app: &mut WizardApp, code: KeyCode, mods: KeyModifiers) {
    if matches!(app.status, Status::Running) {
        return;
    }
    if mods.contains(KeyModifiers::CONTROL) && matches!(code, KeyCode::Char('c')) {
        if let Phase::Scan(s) = &mut app.phase {
            if let Some(h) = &s.handle {
                h.cancel.cancel();
            }
        }
        app.cancelled = true;
        return;
    }

    match &mut app.phase {
        Phase::Form => handle_key_form(app, code).await,
        Phase::Scan(_) => handle_key_scan(app, code).await,
        Phase::Done => {}
    }
}

async fn handle_key_form(app: &mut WizardApp, code: KeyCode) {
    match code {
        KeyCode::Esc => app.cancelled = true,
        KeyCode::Down => {
            app.selected = (app.selected + 1) % FIELDS.len();
            app.path_cycle = None;
        }
        KeyCode::Up | KeyCode::BackTab => {
            app.selected = (app.selected + FIELDS.len() - 1) % FIELDS.len();
            app.path_cycle = None;
        }
        KeyCode::Tab => {
            if app.current_field().is_path() {
                let buf = app.current_buf_mut();
                // borrow split: shadow buf to release before touching app.path_cycle
                let mut tmp_buf = std::mem::take(buf);
                cycle_path(&mut tmp_buf, &mut app.path_cycle);
                *app.current_buf_mut() = tmp_buf;
            } else {
                app.selected = (app.selected + 1) % FIELDS.len();
                app.path_cycle = None;
            }
        }
        KeyCode::Char(' ') if app.current_field().is_bool() => {
            // space toggles the currently-selected bool field.
            // text fields fall through to the regular char handler
            // below so a literal space still types into them.
            app.toggle_current_bool();
            if matches!(app.status, Status::Failed(_)) {
                app.status = Status::Editing;
            }
        }
        KeyCode::Left | KeyCode::Right if app.current_field().is_bool() => {
            // arrow-left/right also toggle bools, mirroring how
            // many tui forms handle yes/no toggles.
            app.toggle_current_bool();
            if matches!(app.status, Status::Failed(_)) {
                app.status = Status::Editing;
            }
        }
        KeyCode::Enter => match app.build_setup_config() {
            Ok(cfg) => {
                app.status = Status::Running;
                let svc = SetupService::new();
                let res = svc.run_setup(cfg).await;
                if res.success {
                    // transition to scan-prompt step
                    app.setup_result = Some(res);
                    app.phase = Phase::Scan(ScanState {
                        music_dir: String::new(),
                        tags_csv: String::new(),
                        selected_path: true,
                        handle: None,
                        progress: None,
                        completion: None,
                        finished: None,
                        error: None,
                        path_cycle: None,
                    });
                    app.status = Status::Editing;
                } else {
                    app.status = Status::Failed(if res.errors.is_empty() {
                        "unknown failure".to_string()
                    } else {
                        res.errors.join("; ")
                    });
                }
            }
            Err(e) => app.status = Status::Failed(e),
        },
        KeyCode::Backspace => {
            if app.current_field().is_bool() {
                return;
            }
            app.current_buf_mut().pop();
            app.path_cycle = None;
            if matches!(app.status, Status::Failed(_)) {
                app.status = Status::Editing;
            }
        }
        KeyCode::Char(c) => {
            if app.current_field().is_bool() {
                return;
            }
            app.current_buf_mut().push(c);
            app.path_cycle = None;
            if matches!(app.status, Status::Failed(_)) {
                app.status = Status::Editing;
            }
        }
        _ => {}
    }
}

async fn handle_key_scan(app: &mut WizardApp, code: KeyCode) {
    let scan = match &mut app.phase {
        Phase::Scan(s) => s,
        _ => return,
    };
    // if a scan is already finished, any key advances to done
    if scan.finished.is_some() {
        app.phase = Phase::Done;
        return;
    }
    // if a scan is in flight, enter or esc finishes the wizard
    // and lets the scan keep running in the background. the rathole
    // tty starts its own job processor on launch and will pick up
    // any pending jobs from the queue. any other key is ignored
    // (no in-place cancel here — ctrl+c still aborts the whole
    // wizard for that).
    if scan.handle.is_some() {
        if matches!(code, KeyCode::Enter | KeyCode::Esc) {
            // graceful background-handoff: cancel the wizard's local
            // processor (lets the current job finish, then exits) and
            // bail to the done screen. any pending jobs already in
            // the db will be picked up by the tty's job processor
            // when it spins up. the scanner task itself keeps running
            // and continues enqueueing until it finishes walking the
            // dir; those jobs land in the same queue.
            if let Some(h) = &scan.handle {
                h.cancel.cancel();
            }
            scan.handle = None;
            scan.finished = Some("scan continues in background. opening rathole...".to_string());
            app.phase = Phase::Done;
        }
        return;
    }
    match code {
        // esc on the scan-prompt step skips this optional step.
        // ctrl+c (handled above) is the way to abort the whole wizard.
        KeyCode::Esc => {
            app.phase = Phase::Done;
        }
        KeyCode::Up | KeyCode::Down | KeyCode::BackTab => {
            scan.selected_path = !scan.selected_path;
            scan.path_cycle = None;
        }
        KeyCode::Tab => {
            if scan.selected_path {
                cycle_path(&mut scan.music_dir, &mut scan.path_cycle);
            } else {
                scan.selected_path = true;
            }
        }
        KeyCode::Enter => {
            // enter always starts the scan (only one meaningful action here)
            start_scan(scan).await;
        }
        KeyCode::Backspace => {
            if scan.selected_path {
                scan.music_dir.pop();
                scan.path_cycle = None;
            } else {
                scan.tags_csv.pop();
            }
        }
        KeyCode::Char(c) => {
            if scan.selected_path {
                scan.music_dir.push(c);
                scan.path_cycle = None;
            } else {
                scan.tags_csv.push(c);
            }
        }
        _ => {}
    }
}

async fn start_scan(scan: &mut ScanState) {
    let raw = scan.music_dir.trim().to_string();
    if raw.is_empty() {
        scan.error = Some("music dir is required (or press esc to skip)".into());
        return;
    }
    // expand `~` so users can type shell-style paths
    let path = expand_tilde(&raw);
    if !Path::new(&path).is_dir() {
        scan.error = Some(format!("not a directory: {path}"));
        return;
    }
    let tags: Vec<String> = scan
        .tags_csv
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    scan.error = None;
    let cancel = CancellationToken::new();
    let enqueue: Arc<Mutex<Option<std::result::Result<usize, String>>>> =
        Arc::new(Mutex::new(None));

    // create the job session row first so the per-file jobs created
    // by `scan_directory` can satisfy their FK on `job_sessionz(id)`.
    // doing this here (rather than inside the spawned task) lets us
    // surface failures synchronously and keeps the session_id stable
    // for the broadcast filter below.
    let session_request = jobs::CreateJobSessionRequest {
        job_type: jobs::JobType::ProcessFile,
        batch_size: None,
        created_by: Some("rathole-wizard".to_string()),
    };
    let session_response = jobs::create_job_session(session_request).await;
    let session_id = match session_response.data {
        Some(s) => s.id,
        None => {
            scan.error = Some(format!(
                "failed to create job session: {}",
                session_response.message
            ));
            return;
        }
    };

    if !tags.is_empty() {
        let tag_res =
            jobs::add_directory_tags(&path, tags.clone(), Some("wizard-scan".to_string())).await;
        if !tag_res.success {
            scan.error = Some(format!(
                "failed to apply directory tags: {}",
                tag_res.message
            ));
            return;
        }
    }

    // spawn the job processor (consumes pending jobs as they appear).
    // it emits JobEvent::Progress / Completed which the
    // wizard's main loop receives via the typed job_events subscription.
    let proc_token = cancel.clone();
    tokio::spawn(async move {
        jobs::run_job_processor_with_token(proc_token).await;
    });

    // spawn the scanner (enqueues jobs into the session).
    // capture the result back into `enqueue` so the main loop can
    // detect "0 files found" (no events ever fire) or hard errors
    // (which would otherwise be silently swallowed).
    let session_for_scan = session_id.clone();
    let path_for_scan = path.clone();
    let enqueue_for_scan = enqueue.clone();
    tokio::spawn(async move {
        let resp = grimoire::music::scan_directory(
            &path_for_scan,
            &session_for_scan,
            true,
            None,
            None,
            true,
        )
        .await;
        let result = match resp.data {
            Some(n) => Ok(n),
            None => {
                let msg = if resp.errors.is_empty() {
                    resp.message
                } else {
                    resp.errors
                        .iter()
                        .map(|e| e.detail.clone())
                        .collect::<Vec<_>>()
                        .join("; ")
                };
                Err(msg)
            }
        };
        if let Ok(mut slot) = enqueue_for_scan.lock() {
            *slot = Some(result);
        }
    });

    scan.handle = Some(ScanHandle {
        session_id,
        cancel,
        enqueue,
    });
    scan.progress = None;
    scan.completion = None;
}

// ---------------------------------------------------------------------------
// path completion
// ---------------------------------------------------------------------------

/// per-field tab-completion state. lets repeated tabs cycle through
/// matches like a shell. invalidated whenever the user edits the buffer
/// or moves to a different field.
struct CompletionState {
    /// byte offset in the buffer where the completion starts (after parent dir)
    cut: usize,
    /// alphabetically sorted matches: (display_name, is_dir)
    matches: Vec<(String, bool)>,
    /// index of the currently-shown match, or None if we've only filled in
    /// the longest-common-prefix and haven't started cycling yet
    idx: Option<usize>,
    /// whatever we last wrote into the buffer; used to detect "user edited
    /// since last tab" — if buf[cut..] != last_filled the cycle is stale
    last_filled: String,
}

/// tab-complete a filesystem path with shell-style cycling.
///
/// behaviour:
///   - first tab: extend to longest common prefix of matching entries.
///     if the lcp is already the full prefix (i.e. ambiguous with no
///     room to grow), jump straight into cycling.
///   - subsequent tabs (with no edits in between): cycle through matches
///     in sorted order.
///   - single match: fill it in, append `/` if it's a directory, no cycle.
///   - zero matches: leave the buffer alone, clear cycle state.
///
/// returns true if `buf` was modified.
fn cycle_path(buf: &mut String, state: &mut Option<CompletionState>) -> bool {
    // if the buffer has changed since we last touched it, the cached cycle
    // is stale — drop it and start over.
    if let Some(s) = state {
        if buf.len() < s.cut || &buf[s.cut..] != s.last_filled {
            *state = None;
        }
    }

    // cycling path: state already valid, just advance idx
    if let Some(s) = state.as_mut() {
        if !s.matches.is_empty() {
            let next = match s.idx {
                Some(i) => (i + 1) % s.matches.len(),
                None => 0,
            };
            s.idx = Some(next);
            let (name, is_dir) = &s.matches[next];
            let mut filled = name.clone();
            if *is_dir && !filled.ends_with('/') {
                filled.push('/');
            }
            buf.truncate(s.cut);
            buf.push_str(&filled);
            s.last_filled = filled;
            return true;
        }
    }

    // fresh completion: parse parent + prefix from buf
    let expanded = expand_tilde(buf);
    let path = Path::new(&expanded);
    let (parent, prefix): (PathBuf, String) = if expanded.is_empty() {
        (PathBuf::from("."), String::new())
    } else if expanded.ends_with('/') {
        (path.to_path_buf(), String::new())
    } else {
        let p = path.parent().unwrap_or_else(|| Path::new(""));
        let parent = if p.as_os_str().is_empty() {
            PathBuf::from(".")
        } else {
            p.to_path_buf()
        };
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        (parent, name)
    };

    let entries = match std::fs::read_dir(&parent) {
        Ok(e) => e,
        Err(_) => {
            *state = None;
            return false;
        }
    };
    let mut matches: Vec<(String, bool)> = Vec::new();
    for ent in entries.flatten() {
        let name = ent.file_name().to_string_lossy().to_string();
        if name.starts_with(&prefix) {
            let is_dir = ent.file_type().map(|t| t.is_dir()).unwrap_or(false);
            matches.push((name, is_dir));
        }
    }
    if matches.is_empty() {
        *state = None;
        return false;
    }
    matches.sort_by(|a, b| a.0.cmp(&b.0));

    // cut = end of parent path in buf (i.e. start of the prefix we'll replace)
    let cut = buf.len().saturating_sub(prefix.len());

    // single match: fill it, no cycle needed
    if matches.len() == 1 {
        let (name, is_dir) = matches.into_iter().next().unwrap();
        let mut filled = name;
        if is_dir && !filled.ends_with('/') {
            filled.push('/');
        }
        buf.truncate(cut);
        buf.push_str(&filled);
        *state = None;
        return true;
    }

    // multiple matches: extend to longest common prefix first if there's
    // room. if lcp == prefix, fall through and cycle to first match.
    let names: Vec<&str> = matches.iter().map(|(n, _)| n.as_str()).collect();
    let lcp = longest_common_prefix(&names).to_string();
    if lcp.len() > prefix.len() {
        buf.truncate(cut);
        buf.push_str(&lcp);
        *state = Some(CompletionState {
            cut,
            matches,
            idx: None,
            last_filled: lcp,
        });
        return true;
    }

    // already at lcp: cycle to the first match
    let (name, is_dir) = (matches[0].0.clone(), matches[0].1);
    let mut filled = name;
    if is_dir && !filled.ends_with('/') {
        filled.push('/');
    }
    buf.truncate(cut);
    buf.push_str(&filled);
    *state = Some(CompletionState {
        cut,
        matches,
        idx: Some(0),
        last_filled: filled,
    });
    true
}

fn expand_tilde(s: &str) -> String {
    let home = std::env::var("HOME").ok();
    if let Some(stripped) = s.strip_prefix("~/") {
        if let Some(h) = home {
            return PathBuf::from(h).join(stripped).display().to_string();
        }
    } else if s == "~" {
        if let Some(h) = home {
            return h;
        }
    }
    s.to_string()
}

fn longest_common_prefix<'a>(strs: &[&'a str]) -> &'a str {
    if strs.is_empty() {
        return "";
    }
    let first = strs[0];
    let mut end = first.len();
    for s in &strs[1..] {
        let mut i = 0;
        let bytes_a = first.as_bytes();
        let bytes_b = s.as_bytes();
        let limit = end.min(bytes_b.len());
        while i < limit && bytes_a[i] == bytes_b[i] {
            i += 1;
        }
        end = i;
        if end == 0 {
            break;
        }
    }
    &first[..end]
}

// ---------------------------------------------------------------------------
// rendering
// ---------------------------------------------------------------------------

fn draw(f: &mut Frame, app: &WizardApp) {
    use Constraint::*;

    let area = f.area();
    let chunks = Layout::vertical([
        Length(3), // header
        Min(10),   // body
        Length(1), // help
    ])
    .split(area);

    draw_header(f, chunks[0], app);
    match &app.phase {
        Phase::Form => draw_form(f, chunks[1], app),
        Phase::Scan(s) => draw_scan(f, chunks[1], s, app),
        Phase::Done => draw_done(f, chunks[1], app),
    }
    draw_help(f, chunks[2], app);
}

fn draw_header(f: &mut Frame, area: Rect, app: &WizardApp) {
    let title = match app.phase {
        Phase::Form => "freqhole setup wizard — step 1/2: install",
        Phase::Scan(_) => "freqhole setup wizard — step 2/2: music scan",
        Phase::Done => "freqhole setup wizard — done",
    };
    let header = Paragraph::new(Line::from(vec![
        Span::styled(title, Style::new().fg(Color::Magenta).bold()),
        Span::raw("  "),
        Span::styled(
            format!("({})", app.config_path.display()),
            Style::new().dim(),
        ),
    ]))
    .block(Block::default().borders(Borders::ALL));
    f.render_widget(header, area);
}

fn draw_form(f: &mut Frame, area: Rect, app: &WizardApp) {
    use Constraint::*;
    let chunks = Layout::vertical([
        Length(FIELDS.len() as u16 * 2 + 2), // fields
        Min(3),                              // status
    ])
    .split(area);

    let mut lines: Vec<Line> = Vec::new();
    for (i, fid) in FIELDS.iter().enumerate() {
        let label = fid.label();
        let value: String = match fid {
            FieldId::DataDir => app.data_dir.clone(),
            FieldId::ServerName => app.server_name.clone(),
            FieldId::Description => app.description.clone(),
            FieldId::AdminUsername => app.admin_username.clone(),
            FieldId::ImagePath => app.image_path.clone(),
            FieldId::EnableHttp => {
                if app.enable_http {
                    "[x] enabled (autostart on rathole launch)".to_string()
                } else {
                    "[ ] disabled".to_string()
                }
            }
            FieldId::EnableP2p => {
                if app.enable_p2p {
                    "[x] enabled (autostart on rathole launch)".to_string()
                } else {
                    "[ ] disabled".to_string()
                }
            }
            FieldId::EnableKnocking => {
                if app.enable_knocking {
                    "[x] enabled (peers can request access)".to_string()
                } else {
                    "[ ] disabled".to_string()
                }
            }
            FieldId::EnableRemoteAdmin => {
                if app.enable_remote_admin {
                    "[x] enabled (admin over p2p)".to_string()
                } else {
                    "[ ] disabled".to_string()
                }
            }
            FieldId::EnableRadio => {
                if app.enable_radio {
                    "[x] enabled".to_string()
                } else {
                    "[ ] disabled".to_string()
                }
            }
            FieldId::EnableFetchMusic => {
                if app.enable_fetch_music {
                    "[x] enabled (download/upload routes)".to_string()
                } else {
                    "[ ] disabled".to_string()
                }
            }
        };
        let is_sel = i == app.selected;
        let label_style = if is_sel {
            Style::new().fg(Color::Black).bg(Color::Magenta).bold()
        } else {
            Style::new().dim()
        };
        // text fields show a block cursor, bool fields show a hint
        // about the toggle key instead.
        let cursor_span = if is_sel && !fid.is_bool() {
            Span::styled("█", Style::new().fg(Color::Magenta))
        } else {
            Span::raw(" ")
        };
        let hint = if is_sel && fid.is_path() {
            Span::styled("  [tab: complete]", Style::new().fg(Color::Magenta).dim())
        } else if is_sel && fid.is_bool() {
            Span::styled("  [space: toggle]", Style::new().fg(Color::Magenta).dim())
        } else {
            Span::raw("")
        };
        lines.push(Line::from(vec![
            Span::styled(format!(" {label} "), label_style),
            Span::raw(" "),
            Span::raw(value),
            cursor_span,
            hint,
        ]));
        lines.push(Line::from(""));
    }
    f.render_widget(
        Paragraph::new(lines).block(Block::default().borders(Borders::ALL).title(" fields ")),
        chunks[0],
    );

    let (text, color, title) = match &app.status {
        Status::Editing => (
            "edit any field, then press enter to run setup.\n\
             this creates the config file, initializes the database,\n\
             runs migrations, and creates the admin user with an api key."
                .to_string(),
            Color::Gray,
            " status ",
        ),
        Status::Running => (
            "running setup... (creating config, db, migrations, admin user)".to_string(),
            Color::Yellow,
            " running ",
        ),
        Status::Failed(e) => (
            format!("setup failed: {e}\n\nedit any field to clear and try again."),
            Color::Red,
            " failed ",
        ),
    };
    f.render_widget(
        Paragraph::new(text)
            .style(Style::new().fg(color))
            .wrap(Wrap { trim: false })
            .block(Block::default().borders(Borders::ALL).title(title)),
        chunks[1],
    );
}

fn draw_scan(f: &mut Frame, area: Rect, scan: &ScanState, app: &WizardApp) {
    use Constraint::*;
    let chunks = Layout::vertical([
        Length(6), // inputs
        Length(4), // progress
        Min(3),    // info
    ])
    .split(area);

    // music dir input
    let path_sel = scan.selected_path && scan.handle.is_none() && scan.finished.is_none();
    let label_style = if path_sel {
        Style::new().fg(Color::Black).bg(Color::Magenta).bold()
    } else {
        Style::new().dim()
    };
    let cursor_span = if path_sel {
        Span::styled("█", Style::new().fg(Color::Magenta))
    } else {
        Span::raw(" ")
    };
    let hint = if path_sel {
        Span::styled("  [tab: complete]", Style::new().fg(Color::Magenta).dim())
    } else {
        Span::raw("")
    };
    let input_lines = vec![
        Line::from(vec![
            Span::styled(" music dir ", label_style),
            Span::raw(" "),
            Span::raw(scan.music_dir.clone()),
            cursor_span,
            hint,
        ]),
        Line::from(vec![
            Span::styled(
                " tags ",
                if !scan.selected_path && scan.handle.is_none() && scan.finished.is_none() {
                    Style::new().fg(Color::Black).bg(Color::Magenta).bold()
                } else {
                    Style::new().dim()
                },
            ),
            Span::raw(" "),
            Span::raw(scan.tags_csv.clone()),
            if !scan.selected_path && scan.handle.is_none() && scan.finished.is_none() {
                Span::styled("█", Style::new().fg(Color::Magenta))
            } else {
                Span::raw(" ")
            },
            Span::styled("  [comma-separated optional tags]", Style::new().dim()),
        ]),
        Line::from(""),
    ];
    f.render_widget(
        Paragraph::new(input_lines).block(
            Block::default()
                .borders(Borders::ALL)
                .title(" optional music scan "),
        ),
        chunks[0],
    );

    // progress gauge — driven by JobProgress events from grimoire
    let (ratio, label) = match (&scan.completion, &scan.progress, &scan.handle) {
        (Some(c), _, _) => (
            1.0,
            format!(
                "done · {} songs · {} albums · {} artists",
                c.songs_added, c.albums_added, c.artists_added
            ),
        ),
        (_, Some(p), _) if p.jobs_total > 0 => {
            let done = p.jobs_total.saturating_sub(p.jobs_pending);
            let ratio = done as f64 / p.jobs_total as f64;
            (
                ratio.clamp(0.0, 1.0),
                format!(
                    "{}/{} jobs · {} songs added",
                    done, p.jobs_total, p.songs_added
                ),
            )
        }
        (_, _, Some(_)) => (0.0, "discovering files...".to_string()),
        _ => (0.0, "press enter to scan, or esc to skip".to_string()),
    };
    f.render_widget(
        Gauge::default()
            .block(
                Block::default()
                    .borders(Borders::ALL)
                    .title(" scan progress "),
            )
            .gauge_style(Style::new().fg(Color::Magenta).bg(Color::Black))
            .ratio(ratio)
            .label(label),
        chunks[1],
    );

    // info / status text
    let (text, color) = if let Some(msg) = &scan.finished {
        (
            format!("{msg}\n\npress any key to launch rathole."),
            Color::Green,
        )
    } else if let Some(err) = &scan.error {
        (format!("error: {err}"), Color::Red)
    } else if scan.handle.is_some() {
        let mut s = String::from(
            "scanning + importing in background.\n\
             press enter or esc to finish the wizard and let the \
             scan continue in the background (ctrl+c aborts).",
        );
        if let Some(p) = &scan.progress {
            if !p.directory.is_empty() {
                s.push_str(&format!("\n\ncurrent: {}", p.directory));
            }
        }
        (s, Color::Yellow)
    } else {
        let mut s = String::from(
            "point at a directory of audio files to scan + import.\n\
               optional tags are applied to that directory before scan.\n\
               leave default or edit, then press enter to scan.\n\
             press esc to skip and finish setup.\n\n",
        );
        if let Some(r) = &app.setup_result {
            s.push_str(&format!("config: {}\n", r.config_path));
            if let Some(k) = &r.api_key {
                s.push_str(&format!("api key: {k}\n"));
            }
        }
        (s, Color::Gray)
    };
    f.render_widget(
        Paragraph::new(text)
            .style(Style::new().fg(color))
            .wrap(Wrap { trim: false })
            .block(Block::default().borders(Borders::ALL).title(" info ")),
        chunks[2],
    );
}

fn draw_done(f: &mut Frame, area: Rect, app: &WizardApp) {
    let mut s = String::from("setup complete!\n\n");
    if let Some(r) = &app.setup_result {
        s.push_str(&format!(
            "config: {}\ndata dir: {}\n",
            r.config_path, r.data_dir
        ));
        if let Some(u) = &r.root_username {
            s.push_str(&format!("system root user: {u}\n"));
        }
        if let Some(u) = &r.admin_username {
            s.push_str(&format!("admin user: {u}\n"));
        }
        if let Some(k) = &r.api_key {
            s.push_str(&format!("api key: {k}\n"));
        }
        // surface any non-fatal warnings (e.g. server image blob
        // failed to materialize) so the user knows to fix them
        // rather than silently shipping a broken-looking server.
        if !r.errors.is_empty() {
            s.push_str("\nwarnings:\n");
            for e in &r.errors {
                s.push_str(&format!("  - {e}\n"));
            }
        }
    }
    s.push_str("\npress any key to launch rathole.");
    f.render_widget(
        Paragraph::new(s)
            .style(Style::new().fg(Color::Green))
            .wrap(Wrap { trim: false })
            .block(Block::default().borders(Borders::ALL).title(" complete ")),
        area,
    );
}

fn draw_help(f: &mut Frame, area: Rect, app: &WizardApp) {
    let text = match &app.phase {
        Phase::Form => {
            " up/down: nav  tab: next field / complete path  enter: run setup  esc: cancel "
        }
        Phase::Scan(s) => {
            if s.finished.is_some() {
                " any key: continue  ctrl+c: abort "
            } else if s.handle.is_some() {
                " esc: cancel scan  ctrl+c: abort "
            } else {
                " up/down: path/tags  tab: complete path  enter: scan  esc: skip  ctrl+c: abort "
            }
        }
        Phase::Done => " any key: launch rathole ",
    };
    f.render_widget(Paragraph::new(Line::from(text.dim())), area);
}
