//! first-run setup wizard. owns its own ratatui terminal and runs a
//! single-screen multi-field form, then calls `grimoire::setup::SetupService`
//! to do the actual work (config file + db init + migrations + admin user).
//!
//! invoked by the cli when `Commands::Rathole` is selected and no
//! `freqhole-config.toml` exists at the resolved path. on success
//! the cli falls through to normal init + tui launch.

use std::path::PathBuf;
use std::time::Duration;

use color_eyre::Result;
use crossterm::event::{Event, EventStream, KeyCode, KeyEventKind, KeyModifiers};
use futures::StreamExt;
use grimoire::setup::{get_defaults, SetupConfig, SetupResult, SetupService};
use ratatui::{
    layout::{Constraint, Layout},
    style::{Color, Style, Stylize},
    text::{Line, Span},
    widgets::{Block, Borders, Paragraph, Wrap},
    DefaultTerminal, Frame,
};

#[derive(Clone, Copy, PartialEq, Eq)]
enum FieldId {
    DataDir,
    ServerName,
    ServerPort,
    AdminUsername,
}

const FIELDS: &[FieldId] = &[
    FieldId::DataDir,
    FieldId::ServerName,
    FieldId::ServerPort,
    FieldId::AdminUsername,
];

enum Status {
    Editing,
    Running,
    Complete(SetupResult),
    Failed(String),
}

struct WizardApp {
    config_path: PathBuf,
    data_dir: String,
    server_name: String,
    server_port: String,
    admin_username: String,
    selected: usize,
    status: Status,
    cancelled: bool,
}

impl WizardApp {
    fn new(config_path: PathBuf) -> Self {
        let d = get_defaults();
        Self {
            config_path,
            data_dir: d.data_dir.display().to_string(),
            server_name: d.server_name,
            server_port: d.server_port.to_string(),
            admin_username: d.username,
            selected: 0,
            status: Status::Editing,
            cancelled: false,
        }
    }

    fn current_buf_mut(&mut self) -> &mut String {
        match FIELDS[self.selected] {
            FieldId::DataDir => &mut self.data_dir,
            FieldId::ServerName => &mut self.server_name,
            FieldId::ServerPort => &mut self.server_port,
            FieldId::AdminUsername => &mut self.admin_username,
        }
    }

    fn build_setup_config(&self) -> std::result::Result<SetupConfig, String> {
        let port: u16 = self
            .server_port
            .trim()
            .parse()
            .map_err(|e: std::num::ParseIntError| format!("invalid port: {e}"))?;
        let trimmed = self.data_dir.trim();
        if trimmed.is_empty() {
            return Err("data dir is required".into());
        }
        let data_dir = PathBuf::from(trimmed);
        let server_name = self.server_name.trim().to_string();
        if server_name.is_empty() {
            return Err("server name is required".into());
        }
        let admin = self.admin_username.trim().to_string();
        Ok(SetupConfig {
            config_path: self.config_path.clone(),
            data_dir,
            server_name,
            server_port: port,
            image_path: None,
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
            server_enabled: Some(true),
            federation_enabled: Some(false),
            knocking_enabled: Some(false),
        })
    }
}

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
    let mut events = EventStream::new();
    let mut tick = tokio::time::interval(Duration::from_millis(250));

    loop {
        terminal.draw(|f| draw(f, &app))?;

        if app.cancelled {
            return Err(color_eyre::eyre::eyre!("setup wizard cancelled"));
        }
        if let Status::Complete(_) = &app.status {
            // wait for keypress to dismiss, then return result
            let ev = events.next().await;
            match ev {
                Some(Ok(Event::Key(k))) if k.kind == KeyEventKind::Press => {
                    if let Status::Complete(r) = std::mem::replace(&mut app.status, Status::Editing)
                    {
                        return Ok(r);
                    }
                }
                Some(Err(e)) => return Err(color_eyre::eyre::eyre!("input stream error: {e}")),
                None => return Err(color_eyre::eyre::eyre!("input stream closed")),
                _ => {}
            }
            continue;
        }

        tokio::select! {
            maybe_ev = events.next() => match maybe_ev {
                Some(Ok(Event::Key(k))) if k.kind == KeyEventKind::Press => {
                    handle_key(&mut app, k.code, k.modifiers).await;
                }
                Some(Ok(_)) => {}
                Some(Err(e)) => return Err(color_eyre::eyre::eyre!("input stream error: {e}")),
                None => return Err(color_eyre::eyre::eyre!("input stream closed")),
            },
            _ = tick.tick() => {}
        }
    }
}

async fn handle_key(app: &mut WizardApp, code: KeyCode, mods: KeyModifiers) {
    if matches!(app.status, Status::Running) {
        return;
    }
    // ctrl-c always cancels
    if mods.contains(KeyModifiers::CONTROL) && matches!(code, KeyCode::Char('c')) {
        app.cancelled = true;
        return;
    }
    match code {
        KeyCode::Esc => app.cancelled = true,
        KeyCode::Tab | KeyCode::Down => {
            app.selected = (app.selected + 1) % FIELDS.len();
        }
        KeyCode::BackTab | KeyCode::Up => {
            app.selected = (app.selected + FIELDS.len() - 1) % FIELDS.len();
        }
        KeyCode::Enter => {
            match app.build_setup_config() {
                Ok(cfg) => {
                    app.status = Status::Running;
                    // note: we do NOT redraw here — the caller's draw on the
                    // next loop iteration will paint the "running" status,
                    // but `run_setup` is awaited inline so the screen stays
                    // on the previous frame until the future resolves. that's
                    // acceptable for a one-shot wizard; a spinner would need
                    // a background task.
                    let svc = SetupService::new();
                    let res = svc.run_setup(cfg).await;
                    if res.success {
                        app.status = Status::Complete(res);
                    } else {
                        app.status = Status::Failed(if res.errors.is_empty() {
                            "unknown failure".to_string()
                        } else {
                            res.errors.join("; ")
                        });
                    }
                }
                Err(e) => app.status = Status::Failed(e),
            }
        }
        KeyCode::Backspace => {
            app.current_buf_mut().pop();
            if matches!(app.status, Status::Failed(_)) {
                app.status = Status::Editing;
            }
        }
        KeyCode::Char(c) => {
            app.current_buf_mut().push(c);
            if matches!(app.status, Status::Failed(_)) {
                app.status = Status::Editing;
            }
        }
        _ => {}
    }
}

fn draw(f: &mut Frame, app: &WizardApp) {
    use Constraint::*;

    let area = f.area();
    let chunks = Layout::vertical([
        Length(3),                           // header
        Length(FIELDS.len() as u16 * 2 + 2), // fields box
        Min(5),                              // status
        Length(1),                           // help
    ])
    .split(area);

    // header
    let header = Paragraph::new(Line::from(vec![
        Span::styled("freqhole setup wizard", Style::new().fg(Color::Cyan).bold()),
        Span::raw("  "),
        Span::styled(
            format!("(no install found at {})", app.config_path.display()),
            Style::new().dim(),
        ),
    ]))
    .block(Block::default().borders(Borders::ALL));
    f.render_widget(header, chunks[0]);

    // fields
    let mut lines: Vec<Line> = Vec::new();
    for (i, fid) in FIELDS.iter().enumerate() {
        let (label, value) = match fid {
            FieldId::DataDir => ("data dir       ", app.data_dir.as_str()),
            FieldId::ServerName => ("server name    ", app.server_name.as_str()),
            FieldId::ServerPort => ("server port    ", app.server_port.as_str()),
            FieldId::AdminUsername => ("admin username ", app.admin_username.as_str()),
        };
        let is_sel = i == app.selected;
        let label_style = if is_sel {
            Style::new().fg(Color::Black).bg(Color::Cyan).bold()
        } else {
            Style::new().dim()
        };
        let cursor_span = if is_sel {
            Span::styled("█", Style::new().fg(Color::Cyan))
        } else {
            Span::raw(" ")
        };
        lines.push(Line::from(vec![
            Span::styled(format!(" {label} "), label_style),
            Span::raw(" "),
            Span::raw(value.to_string()),
            cursor_span,
        ]));
        lines.push(Line::from(""));
    }
    f.render_widget(
        Paragraph::new(lines).block(Block::default().borders(Borders::ALL).title(" fields ")),
        chunks[1],
    );

    // status
    let (text, color, title) = match &app.status {
        Status::Editing => (
            "ready. edit any field, then press Enter to run setup.\n\
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
        Status::Complete(r) => {
            let mut s = format!(
                "setup complete!\n\nconfig: {}\ndata dir: {}",
                r.config_path, r.data_dir
            );
            if let Some(u) = &r.root_username {
                s.push_str(&format!("\nsystem root user: {u}"));
            }
            if let Some(u) = &r.admin_username {
                s.push_str(&format!("\nadmin user: {u}"));
            }
            if let Some(k) = &r.api_key {
                s.push_str(&format!("\napi key: {k}"));
            }
            s.push_str("\n\npress any key to launch rathole.");
            (s, Color::Green, " complete ")
        }
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
        chunks[2],
    );

    // help line
    let help = Paragraph::new(Line::from(
        " Tab/Down: next  Shift+Tab/Up: prev  Enter: run setup  Esc/Ctrl+C: cancel ".dim(),
    ));
    f.render_widget(help, chunks[3]);
}
