use crate::ratcore::{
    jobs::{duration, timestamp, JobsView, TABS},
    theme::ACCENT,
};
use ratatui::{
    layout::{Constraint, Layout, Rect},
    style::{Color, Style, Stylize},
    text::{Line, Span},
    widgets::{Block, List, ListItem, ListState, Paragraph, Wrap},
    Frame,
};

pub fn draw(frame: &mut Frame, area: Rect, view: &JobsView) {
    let [tabs, filters, notice, mut body] = Layout::vertical([
        Constraint::Length(1),
        Constraint::Length(1),
        Constraint::Length(1),
        Constraint::Min(0),
    ])
    .areas(area);
    let tab_spans = TABS
        .iter()
        .enumerate()
        .map(|(i, tab)| {
            Span::styled(
                format!(" {} ", tab.to_lowercase()),
                if i == view.tab {
                    Style::new().bg(ACCENT).fg(Color::White).bold()
                } else {
                    Style::new().dim()
                },
            )
        })
        .collect::<Vec<_>>();
    let tab_end = TABS
        .iter()
        .take(view.tab + 1)
        .map(|s| s.len() + 2)
        .sum::<usize>();
    let tab_scroll = tab_end.saturating_sub(tabs.width as usize) as u16;
    frame.render_widget(
        Paragraph::new(Line::from(tab_spans)).scroll((0, tab_scroll)),
        tabs,
    );
    frame.render_widget(
        Paragraph::new(format!(
            "{}search: {}   session: {}   type: {}",
            if view.editing { "editing " } else { "" },
            view.query,
            view.session_id.as_deref().unwrap_or("all"),
            view.job_type.as_deref().unwrap_or("all"),
        )),
        filters,
    );
    let message = if view.confirm_close_all {
        "close all idle sessions? y/enter: confirm, any other key: cancel".into()
    } else if view.confirm_close.is_some() {
        "close idle session? y/enter: confirm, any other key: cancel".into()
    } else if view.confirm_retry {
        "retry this failed job? side effects and child jobs may repeat. y/enter: retry, any other key: cancel".into()
    } else if view.retrying {
        "applying job action...".into()
    } else if let Some(error) = &view.error {
        format!("jobs unavailable (last snapshot may be stale): {error}")
    } else if let Some(notice) = &view.mutation_notice {
        notice.clone()
    } else {
        format!("{}tab: panes  enter: inspect  x: close idle session  X: close all idle  f: search  c: clear filters  arrows: select/tabs  r: refresh/retry  esc: back",
            if view.loading { "refreshing... " } else { "" })
    };
    frame.render_widget(
        Paragraph::new(message).style(
            if view.error.is_some()
                || view.confirm_retry
                || view.confirm_close.is_some()
                || view.confirm_close_all
            {
                Style::new().fg(Color::Yellow)
            } else {
                Style::new().dim()
            },
        ),
        notice,
    );
    let Some(snapshot) = &view.snapshot else {
        frame.render_widget(Paragraph::new("loading jobs..."), body);
        return;
    };
    if view.confirm_close_all {
        frame.render_widget(
            Paragraph::new("close all idle sessions in this library, including those on other pages?\n\nhistory and failure details are kept. sessions with pending/running jobs are skipped. this does not stop workflows from adding later jobs.\n\ny/enter: close all idle sessions; any other key: cancel")
                .wrap(Wrap { trim: false })
                .block(Block::bordered().title("close all idle sessions")),
            body,
        );
        return;
    }
    if let Some(id) = &view.confirm_close {
        frame.render_widget(Paragraph::new(format!(
            "session {id}\n\nno pending/running jobs. remove from overview; keep history and failure details.\nthis does not stop a multi-step workflow from adding later jobs; close only if that workflow has finished.\n\ny/enter: close session; any other key: cancel"
        )).wrap(Wrap { trim: false }).block(Block::bordered().title("close idle session")), body);
        return;
    }
    if let Some(id) = &view.detail_id {
        let text = if let Some(detail) = &snapshot.detail {
            let mut lines = vec![
                format!("job {id}"),
                "r: retry a failed job (confirmation required)".into(),
                String::new(),
            ];
            if let Some(job) = snapshot
                .detail_summary
                .iter()
                .chain(snapshot.jobs.iter())
                .chain(snapshot.active_jobs.iter())
                .find(|j| &j.id == id)
            {
                lines.push(format!(
                    "{}  {}  {}",
                    job.job_type,
                    if job.skipped { "skipped" } else { &job.status },
                    job.progress(view.now)
                ));
                lines.push(format!(
                    "queued: {}",
                    timestamp(Some(job.scheduled_at), view.now)
                ));
                lines.push(format!("started: {}", timestamp(job.started_at, view.now)));
                lines.push(format!(
                    "finished: {}",
                    timestamp(job.completed_at, view.now)
                ));
                lines.push(format!(
                    "last activity: {} ({})",
                    timestamp(job.last_activity_at, view.now),
                    job.activity_source
                        .as_deref()
                        .unwrap_or("lifecycle timestamp")
                ));
                if let Some(message) = &job.message {
                    lines.push(message.clone());
                }
            }
            if let Some(error) = detail
                .get("error_message")
                .and_then(serde_json::Value::as_str)
            {
                lines.push(format!("failure: {error}"));
            }
            for (label, key) in [
                ("parameters", "parameters"),
                ("result / structured errors", "result"),
            ] {
                if let Some(raw) = detail.get(key).and_then(serde_json::Value::as_str) {
                    let parsed = serde_json::from_str::<serde_json::Value>(raw);
                    let pretty = parsed
                        .as_ref()
                        .ok()
                        .and_then(|v| serde_json::to_string_pretty(v).ok())
                        .unwrap_or_else(|| raw.into());
                    lines.push(format!("\n{label}:\n{pretty}"));
                }
            }
            lines.push(format!(
                "\nstatus: {}   retry count / limit: {} / {}",
                detail["status"].as_str().unwrap_or("unknown"),
                detail["retry_count"],
                detail["max_retries"]
            ));
            lines.join("\n")
        } else if view.loading {
            "loading job details...".into()
        } else {
            "job no longer exists (completed scan jobs may be pruned)".into()
        };
        frame.render_widget(
            Paragraph::new(text)
                .wrap(Wrap { trim: false })
                .scroll((view.detail_scroll, 0))
                .block(Block::bordered().title("job details")),
            body,
        );
        return;
    }
    if let Some(session) = &snapshot.selected_session {
        let [summary, rest] =
            Layout::vertical([Constraint::Length(5), Constraint::Min(0)]).areas(body);
        let span = match (session.started_at, session.ended_at) {
            (Some(start), Some(end)) => duration(end.saturating_sub(start).max(0) as u64),
            _ => "unknown (unfinished or pruned job timestamps)".into(),
        };
        frame.render_widget(Paragraph::new(format!(
            "session {}  {}  {} running / {} pending{}\nlast activity: {}\ncreated: {}\nrun span: {}",
            short_id(&session.id), format!("{}{}", session.status.to_lowercase(), if session.closed { " (closed)" } else { "" }), session.running, session.pending,
            if session.can_close { "  x: close idle session" } else { "" },
            timestamp(session.updated_at, view.now), timestamp(session.created_at, view.now), span
        )).block(Block::bordered().title("session details")), summary);
        body = rest;
    }
    if view.tab == 0 {
        let [summary, groups, work] = Layout::vertical([
            Constraint::Length(3),
            Constraint::Length(5),
            Constraint::Min(0),
        ])
        .areas(body);
        let s = &snapshot.stats;
        frame.render_widget(Paragraph::new(format!(
            "running {}   pending {}   failed {}\ncompleted {}   cancelled {}   sessions {}\ncounts cover retained jobs; completed scan rows may be pruned",
            s.running,s.pending,s.failed,s.completed,s.cancelled,s.sessions,
        )), summary);
        let mut lines = snapshot
            .groups
            .iter()
            .filter(|g| matches!(g.status.as_str(), "Running" | "Pending" | "Failed"))
            .take(4)
            .map(|g| {
                Line::from(format!(
                    "{}  {}: {}",
                    g.job_type,
                    g.status.to_lowercase(),
                    g.count
                ))
            })
            .collect::<Vec<_>>();
        if lines.is_empty() {
            lines.push(Line::from("no queued work or retained failures"));
        }
        frame.render_widget(
            Paragraph::new(lines).block(Block::bordered().title("work by type (top groups)")),
            groups,
        );
        let [running, sessions] = if work.width >= 90 {
            Layout::horizontal([Constraint::Percentage(60), Constraint::Percentage(40)]).areas(work)
        } else {
            Layout::vertical([Constraint::Percentage(60), Constraint::Percentage(40)]).areas(work)
        };
        draw_jobs(
            frame,
            running,
            view,
            "running (up to 8; running tab shows all)",
        );
        draw_sessions(
            frame,
            sessions,
            view,
            "open sessions (tab: focus, enter: inspect)",
        );
    } else if view.tab == 5 {
        draw_sessions(frame, body, view, &page_title(view));
    } else {
        draw_jobs(frame, body, view, &page_title(view));
    }
}

fn page_title(view: &JobsView) -> String {
    view.snapshot
        .as_ref()
        .map(|s| {
            format!(
                "{}  page {}/{}  {} matching",
                TABS[view.tab].to_lowercase(),
                s.page + 1,
                s.total.saturating_sub(1) / s.page_size.max(1) + 1,
                s.total,
            )
        })
        .unwrap_or_default()
}

fn draw_jobs(frame: &mut Frame, area: Rect, view: &JobsView, title: &str) {
    let items = view
        .snapshot
        .as_ref()
        .map(|s| {
            s.jobs
                .iter()
                .map(|job| {
                    let description = job
                        .error_message
                        .as_deref()
                        .or(job.message.as_deref())
                        .or(job.stage.as_deref())
                        .unwrap_or("");
                    ListItem::new(vec![
                        Line::from(format!(
                            "{}  {}  {}",
                            short_id(&job.id),
                            job.job_type,
                            if job.skipped {
                                "skipped".into()
                            } else {
                                job.status.to_lowercase()
                            },
                        )),
                        Line::from(format!("  {}", job.progress(view.now))),
                        Line::from(Span::raw(format!("  {description}")).dim()),
                        Line::from(format!(
                            "  {}: {}",
                            if job.completed_at.is_some() {
                                "finished"
                            } else if job.started_at.is_some() {
                                "started"
                            } else {
                                "queued"
                            },
                            timestamp(
                                job.completed_at
                                    .or(job.started_at)
                                    .or(Some(job.scheduled_at)),
                                view.now
                            )
                        )),
                        Line::from(format!(
                            "  last activity: {}",
                            timestamp(job.last_activity_at, view.now)
                        )),
                    ])
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    draw_list(
        frame,
        area,
        items,
        (!view.sessions_focused()).then_some(view.cursor),
        title,
    );
}

fn draw_sessions(frame: &mut Frame, area: Rect, view: &JobsView, title: &str) {
    let items = view
        .snapshot
        .as_ref()
        .map(|snapshot| {
            snapshot
                .sessions
                .iter()
                .map(|s| {
                    let progress = s
                        .progress
                        .as_deref()
                        .and_then(|p| serde_json::from_str::<serde_json::Value>(p).ok());
                    let extra = progress
                        .as_ref()
                        .map(|p| format!("  progress {}/{}", p["current"], p["total"]))
                        .unwrap_or_default();
                    ListItem::new(format!(
                        "{}  {}  {}{}\n  running {} pending {} done {} failed {} cancelled {}{}\n  last activity: {}",
                        short_id(&s.id),
                        s.job_type,
                        format!("{}{}", s.status, if s.closed { " (closed)" } else { "" }),
                        if s.can_close { " (idle; x: close)" } else { "" },
                        s.running,
                        s.pending,
                        s.completed,
                        s.failed,
                        s.cancelled,
                        extra,
                        timestamp(s.updated_at, view.now),
                    ))
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    draw_list(
        frame,
        area,
        items,
        view.sessions_focused().then_some(view.cursor),
        title,
    );
}

fn short_id(id: &str) -> String {
    id.chars().take(12).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ratcore::jobs::{OverviewPane, SessionRow, Snapshot};
    use ratatui::{backend::TestBackend, Terminal};
    use serde_json::json;

    fn view() -> JobsView {
        let row = json!({
            "id":"01234567-89ab-cdef-0123-456789abcdef","session_id":"session",
            "job_type":"RegenerateVideoPosters","status":"Running","scheduled_at":90,
            "started_at":100,"completed_at":null,"retry_count":0,"max_retries":0,
            "error_message":null,"stage":"posters","message":"extracting poster","checked":5,"total":10
        });
        let snapshot: Snapshot = serde_json::from_value(json!({
            "stats":{"running":1,"pending":100,"failed":1,"completed":2,"cancelled":0,"sessions":1},
            "groups":[{"job_type":"RegenerateVideoPosters","status":"Running","count":1}],
            "jobs":[row.clone()],"active_jobs":[row.clone()],"sessions":[],
            "total":1,"page":0,"page_size":20,
            "detail":{"status":"Failed","error_message":"disk offline","parameters":"{\"dry_run\":false}",
                "result":"[{\"error_type\":\"video_poster_regeneration_failed\",\"detail\":\"disk offline\"}]",
                "retry_count":0,"max_retries":0},
            "detail_summary":row
        })).unwrap();
        let mut view = JobsView::default();
        view.snapshot = Some(snapshot);
        view.now = 110;
        view
    }

    fn render(view: &JobsView, width: u16, height: u16) -> String {
        let mut terminal = Terminal::new(TestBackend::new(width, height)).unwrap();
        terminal.draw(|f| draw(f, f.area(), view)).unwrap();
        terminal
            .backend()
            .buffer()
            .content()
            .chunks(width as usize)
            .map(|row| row.iter().map(|cell| cell.symbol()).collect::<String>())
            .collect::<Vec<_>>()
            .join("\n")
    }

    #[test]
    fn bulk_close_confirmation_explains_scope_and_preserves_history() {
        let mut view = view();
        view.confirm_close_all = true;
        let text = render(&view, 80, 30);
        assert!(text.contains("other pages"), "{text}");
        assert!(
            text.contains("history and failure details are kept"),
            "{text}"
        );
        assert!(text.contains("pending/running jobs are"), "{text}");
        assert!(text.contains("skipped."), "{text}");
        assert!(text.contains("y/enter: close all idle sessions"), "{text}");
    }

    #[test]
    fn overview_and_running_keep_progress_visible_at_80_columns() {
        let mut view = view();
        let text = render(&view, 80, 30);
        assert!(text.contains("pending 100"));
        assert!(text.contains("50%  running for 10s ~10s left"), "{text}");
        assert!(!text.contains("01234567-89ab-cdef"));
        view.tab = 1;
        let text = render(&view, 80, 24);
        assert!(text.contains("50%  running for 10s ~10s left"), "{text}");
        assert!(text.contains("extracting poster"));
    }

    #[test]
    fn overview_highlights_only_the_focused_pane_at_narrow_and_wide_sizes() {
        let mut view = view();
        view.snapshot.as_mut().unwrap().sessions.push(SessionRow {
            id: "session-a".into(),
            job_type: "ScanDirectory".into(),
            status: "Running".into(),
            progress: None,
            pending: 2,
            running: 1,
            completed: 0,
            failed: 0,
            cancelled: 0,
            created_at: Some(90),
            updated_at: Some(100),
            started_at: Some(100),
            ended_at: None,
            can_close: false,
            closed: false,
        });
        for width in [80, 120] {
            view.overview_pane = OverviewPane::Running;
            let text = render(&view, width, 30);
            assert!(text.contains("> 01234567-89"), "{text}");
            assert!(!text.contains("> session-a"), "{text}");
            view.overview_pane = OverviewPane::Sessions;
            let text = render(&view, width, 30);
            assert!(text.contains("> session-a"), "{text}");
            assert!(!text.contains("> 01234567-89"), "{text}");
        }
    }

    #[test]
    fn failed_detail_shows_errors_and_confirmation_instead_of_an_automatic_retry() {
        let mut view = view();
        view.detail_id = Some(view.snapshot.as_ref().unwrap().jobs[0].id.clone());
        let text = render(&view, 80, 30);
        assert!(text.contains("failure: disk offline"));
        assert!(text.contains("video_poster_regeneration_failed"));
        view.confirm_retry = true;
        assert!(render(&view, 80, 30).contains("retry this failed job?"));
    }

    #[test]
    fn disconnected_scan_attempts_are_labeled_skipped_in_lists_and_details() {
        let mut view = view();
        let snapshot = view.snapshot.as_mut().unwrap();
        snapshot.jobs[0].status = "Completed".into();
        snapshot.jobs[0].skipped = true;
        snapshot.jobs[0].message = Some("library source disconnected".into());
        snapshot.detail_summary = Some(snapshot.jobs[0].clone());
        view.tab = 4;
        assert!(render(&view, 100, 30).contains("skipped"));
        view.detail_id = Some(view.snapshot.as_ref().unwrap().jobs[0].id.clone());
        assert!(render(&view, 100, 30).contains("skipped"));
    }

    #[test]
    fn narrow_and_short_terminals_render_without_panicking() {
        let mut view = view();
        for tab in 0..TABS.len() {
            view.tab = tab;
            for (width, height) in [(40, 12), (12, 4), (1, 1)] {
                render(&view, width, height);
            }
        }
    }
}

fn draw_list(
    frame: &mut Frame,
    area: Rect,
    items: Vec<ListItem>,
    cursor: Option<usize>,
    title: &str,
) {
    let block = Block::bordered()
        .title(title)
        .border_style(if cursor.is_some() {
            Style::new().fg(ACCENT)
        } else {
            Style::default()
        });
    if items.is_empty() {
        frame.render_widget(
            Paragraph::new("no matching jobs or sessions").block(block),
            area,
        );
        return;
    }
    let mut state = ListState::default().with_selected(cursor);
    frame.render_stateful_widget(
        List::new(items)
            .block(block)
            .highlight_style(Style::new().bg(Color::DarkGray))
            .highlight_symbol("> "),
        area,
        &mut state,
    );
}
