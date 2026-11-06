//! portable jobs dashboard state, navigation and polling contract.

use serde::Deserialize;
use serde_json::{json, Value};

use super::app::{DispatchResponse, Focus};

pub const TABS: &[&str] = &[
    "overview",
    "Running",
    "Pending",
    "Failed",
    "Completed",
    "sessions",
    "all",
    "Cancelled",
];

#[derive(Debug, Clone, Default, Deserialize)]
pub struct Stats {
    pub running: u64,
    pub pending: u64,
    pub failed: u64,
    pub completed: u64,
    pub cancelled: u64,
    pub sessions: u64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Group {
    pub job_type: String,
    pub status: String,
    pub count: u64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct JobRow {
    pub id: String,
    pub session_id: Option<String>,
    pub job_type: String,
    pub status: String,
    pub scheduled_at: i64,
    pub started_at: Option<i64>,
    pub completed_at: Option<i64>,
    pub retry_count: u32,
    pub max_retries: u32,
    pub error_message: Option<String>,
    pub stage: Option<String>,
    pub message: Option<String>,
    pub checked: Option<u64>,
    pub total: Option<u64>,
    pub last_activity_at: Option<i64>,
    pub activity_source: Option<String>,
    #[serde(default)]
    pub skipped: bool,
}

impl JobRow {
    pub fn progress(&self, now: i64) -> String {
        let elapsed = self
            .started_at
            .filter(|_| self.completed_at.is_some() || self.status == "Running")
            .map(|start| {
                self.completed_at
                    .unwrap_or(now)
                    .saturating_sub(start)
                    .max(0) as u64
            });
        let age = elapsed
            .map(|seconds| {
                format!(
                    "{} {}",
                    if self.status == "Running" {
                        "running for"
                    } else {
                        "ran for"
                    },
                    duration(seconds)
                )
            })
            .unwrap_or_else(|| {
                if self.started_at.is_some() {
                    "duration unknown".into()
                } else {
                    "not started".into()
                }
            });
        match (self.checked, self.total) {
            (Some(done), Some(total)) if total > 0 => {
                let percent = done.min(total).saturating_mul(100) / total;
                let eta = match (done, elapsed) {
                    (1.., Some(seconds))
                        if seconds >= 5 && done < total && self.status == "Running" =>
                    {
                        format!(
                            " ~{} left",
                            duration(seconds.saturating_mul(total - done) / done)
                        )
                    }
                    _ => String::new(),
                };
                format!("{percent}%  {age}{eta}")
            }
            _ if self.status == "Running" => format!("{} {age}  eta unknown", spinner(now)),
            _ => age,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct SessionRow {
    pub id: String,
    pub job_type: String,
    pub status: String,
    pub progress: Option<String>,
    pub pending: u64,
    pub running: u64,
    pub completed: u64,
    pub failed: u64,
    pub cancelled: u64,
    pub created_at: Option<i64>,
    pub updated_at: Option<i64>,
    pub started_at: Option<i64>,
    pub ended_at: Option<i64>,
    #[serde(default)]
    pub can_close: bool,
    #[serde(default)]
    pub closed: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Snapshot {
    pub stats: Stats,
    pub groups: Vec<Group>,
    pub jobs: Vec<JobRow>,
    pub active_jobs: Vec<JobRow>,
    pub sessions: Vec<SessionRow>,
    pub total: u64,
    pub page: u32,
    pub page_size: u64,
    pub detail: Option<Value>,
    pub detail_summary: Option<JobRow>,
    pub selected_session: Option<SessionRow>,
}

#[derive(Debug, Clone, Default)]
pub struct JobsView {
    pub tab: usize,
    pub overview_pane: OverviewPane,
    pub query: String,
    pub job_type: Option<String>,
    pub editing: bool,
    pub session_id: Option<String>,
    pub cursor: usize,
    pub page: u32,
    pub detail_id: Option<String>,
    pub detail_scroll: u16,
    pub confirm_retry: bool,
    pub confirm_close: Option<String>,
    pub confirm_close_all: bool,
    pub mutation_notice: Option<String>,
    pub snapshot: Option<Snapshot>,
    pub error: Option<String>,
    pub loading: bool,
    pub retrying: bool,
    pub generation: u64,
    pub next_poll: u64,
    pub now: i64,
    peer: Option<String>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum OverviewPane {
    #[default]
    Running,
    Sessions,
}

#[derive(Debug, Clone, Copy)]
pub enum JobsKey {
    Up,
    Down,
    Left,
    Right,
    Enter,
    Escape,
    Backspace,
    PageUp,
    PageDown,
    Tab,
    BackTab,
    Char(char),
}

impl JobsView {
    pub fn invalidate(&mut self) {
        self.generation = self.generation.wrapping_add(1);
        self.loading = false;
        self.next_poll = 0;
        self.confirm_retry = false;
        self.confirm_close = None;
        self.confirm_close_all = false;
        self.retrying = false;
    }

    pub fn open(&mut self, view: &str, query: String, session: Option<String>) {
        self.tab = TABS.iter().position(|s| *s == view).unwrap_or(0);
        self.overview_pane = OverviewPane::Running;
        self.query = query;
        self.session_id = session;
        self.cursor = 0;
        self.page = 0;
        self.detail_id = None;
        self.detail_scroll = 0;
        self.snapshot = None;
        self.error = None;
        self.mutation_notice = None;
        self.invalidate();
    }

    pub fn poll(
        &mut self,
        now_ms: u64,
        peer: Option<String>,
        visible: bool,
    ) -> Option<(u64, Value)> {
        self.now = (now_ms / 1000) as i64;
        if self.peer != peer {
            self.peer = peer;
            self.snapshot = None;
            self.error = None;
            self.mutation_notice = None;
            self.invalidate();
        }
        if self.loading || now_ms < self.next_poll {
            return None;
        }
        self.loading = true;
        self.next_poll = now_ms + if visible { 2000 } else { 5000 };
        Some((
            self.generation,
            json!({
                "view": TABS[self.tab], "query": self.query,
                "session_id": self.session_id, "page": self.page, "job_id": self.detail_id,
                "job_type": self.job_type,
            }),
        ))
    }

    pub fn receive(&mut self, generation: u64, response: DispatchResponse) {
        if generation != self.generation {
            return;
        }

        self.loading = false;
        if !response.success {
            self.error = Some(response.message);
            self.next_poll = self.now.max(0) as u64 * 1000 + 10_000;
            return;
        }
        match response
            .data
            .ok_or_else(|| "job dashboard returned no data".into())
            .and_then(|data| {
                serde_json::from_value::<Snapshot>(data)
                    .map_err(|e| format!("invalid jobs reply: {e}"))
            }) {
            Ok(snapshot) => {
                let selected = self.selected_id().map(str::to_owned);
                self.page = snapshot.page;
                self.snapshot = Some(snapshot);
                if let Some(id) = selected {
                    let position = if self.sessions_focused() {
                        self.snapshot
                            .as_ref()
                            .and_then(|s| s.sessions.iter().position(|r| r.id == id))
                    } else {
                        self.snapshot
                            .as_ref()
                            .and_then(|s| s.jobs.iter().position(|r| r.id == id))
                    };
                    if let Some(position) = position {
                        self.cursor = position;
                    }
                }
                self.cursor = self.cursor.min(self.row_count().saturating_sub(1));
                self.error = None;
            }
            Err(error) => self.error = Some(error),
        }
    }

    pub fn receive_mutation(&mut self, generation: u64, response: DispatchResponse) {
        if generation != self.generation {
            return;
        }
        self.invalidate();
        self.mutation_notice = Some(if response.success {
            match response.data.as_ref().and_then(|data| data.get("closed_sessions")).and_then(Value::as_u64) {
                Some(count) => format!("closed {count} idle sessions; history preserved; pending/running work left alone"),
                None => response.message.clone(),
            }
        } else {
            format!("job action failed: {}", response.message)
        });
        self.error = if response.success {
            None
        } else {
            Some(response.message)
        };
    }

    pub fn row_count(&self) -> usize {
        self.snapshot
            .as_ref()
            .map(|s| {
                if self.sessions_focused() {
                    s.sessions.len()
                } else {
                    s.jobs.len()
                }
            })
            .unwrap_or(0)
    }

    fn selected_id(&self) -> Option<&str> {
        self.snapshot.as_ref().and_then(|s| {
            if self.sessions_focused() {
                s.sessions.get(self.cursor).map(|r| r.id.as_str())
            } else {
                s.jobs.get(self.cursor).map(|r| r.id.as_str())
            }
        })
    }

    pub fn sessions_focused(&self) -> bool {
        self.tab == 5 || (self.tab == 0 && self.overview_pane == OverviewPane::Sessions)
    }

    pub fn key(&mut self, key: JobsKey, focus: &mut Focus) -> Option<Value> {
        if self.retrying && matches!(key, JobsKey::Char('r') | JobsKey::Enter) {
            return None;
        }
        if self.editing {
            match key {
                JobsKey::Enter | JobsKey::Escape => self.editing = false,
                JobsKey::Backspace => {
                    self.query.pop();
                }
                JobsKey::Char(c) if !c.is_control() && self.query.len() + c.len_utf8() <= 256 => {
                    self.query.push(c)
                }
                _ => return None,
            }
            self.page = 0;
            self.cursor = 0;
            self.invalidate();
            return None;
        }
        if self.confirm_retry {
            self.confirm_retry = false;
            if matches!(key, JobsKey::Enter | JobsKey::Char('y')) {
                self.retrying = true;
                return self
                    .detail_id
                    .as_ref()
                    .map(|id| json!({"job_id": id, "confirm": true}));
            }
            return None;
        }
        if let Some(id) = self.confirm_close.take() {
            if matches!(key, JobsKey::Enter | JobsKey::Char('y')) {
                self.retrying = true;
                return Some(json!({"session_id": id, "confirm": true}));
            }
            return None;
        }
        if self.confirm_close_all {
            self.confirm_close_all = false;
            if matches!(key, JobsKey::Enter | JobsKey::Char('y')) {
                self.retrying = true;
                self.mutation_notice = None;
                return Some(json!({"all_idle_sessions": true, "confirm": true}));
            }
            return None;
        }
        match key {
            JobsKey::Tab | JobsKey::BackTab if self.tab == 0 && self.detail_id.is_none() => {
                self.overview_pane = match self.overview_pane {
                    OverviewPane::Running => OverviewPane::Sessions,
                    OverviewPane::Sessions => OverviewPane::Running,
                };
                self.cursor = 0;
            }
            JobsKey::Escape => {
                if self.detail_id.take().is_some() {
                    self.detail_scroll = 0;
                    self.invalidate();
                } else if self.session_id.take().is_some() {
                    self.open("sessions", String::new(), None);
                } else {
                    *focus = Focus::Landing;
                }
            }
            JobsKey::Up if self.detail_id.is_some() => {
                self.detail_scroll = self.detail_scroll.saturating_sub(1)
            }
            JobsKey::Down if self.detail_id.is_some() => {
                self.detail_scroll = self.detail_scroll.saturating_add(1)
            }
            JobsKey::Up => self.cursor = self.cursor.saturating_sub(1),
            JobsKey::Down => {
                self.cursor = (self.cursor + 1).min(self.row_count().saturating_sub(1))
            }
            JobsKey::Left | JobsKey::Right if self.detail_id.is_none() => {
                let tab = if matches!(key, JobsKey::Right) {
                    (self.tab + 1) % TABS.len()
                } else {
                    (self.tab + TABS.len() - 1) % TABS.len()
                };
                self.open(TABS[tab], self.query.clone(), self.session_id.clone());
            }
            JobsKey::PageUp if self.detail_id.is_some() => {
                self.detail_scroll = self.detail_scroll.saturating_sub(10)
            }
            JobsKey::PageDown if self.detail_id.is_some() => {
                self.detail_scroll = self.detail_scroll.saturating_add(10)
            }
            JobsKey::PageUp | JobsKey::PageDown if self.tab != 0 => {
                let max_page = self
                    .snapshot
                    .as_ref()
                    .map(|s| s.total.saturating_sub(1) / s.page_size.max(1))
                    .unwrap_or(0);
                self.page = if matches!(key, JobsKey::PageDown) {
                    (self.page + 1).min(max_page as u32)
                } else {
                    self.page.saturating_sub(1)
                };
                self.cursor = 0;
                self.invalidate();
            }
            JobsKey::Enter if self.detail_id.is_none() => {
                if let Some(id) = self.selected_id().map(str::to_owned) {
                    if self.sessions_focused() {
                        self.open("all", String::new(), Some(id));
                    } else {
                        if let Some(snapshot) = &mut self.snapshot {
                            if snapshot
                                .detail
                                .as_ref()
                                .and_then(|d| d.get("id"))
                                .and_then(Value::as_str)
                                != Some(id.as_str())
                            {
                                snapshot.detail = None;
                                snapshot.detail_summary = None;
                            }
                        }
                        self.detail_id = Some(id);
                        self.detail_scroll = 0;
                        self.invalidate();
                    }
                }
            }
            JobsKey::Char('f') => {
                self.editing = true;
            }
            JobsKey::Char('c') => {
                self.query.clear();
                self.job_type = None;
                self.session_id = None;
                self.page = 0;
                self.invalidate();
            }
            JobsKey::Char('X') if self.detail_id.is_none() && !self.retrying => {
                self.confirm_close_all = true;
                self.mutation_notice = None;
            }
            JobsKey::Char('x') if self.detail_id.is_none() && !self.retrying => {
                let session = self.snapshot.as_ref().and_then(|snapshot| {
                    if self.sessions_focused() {
                        snapshot.sessions.get(self.cursor)
                    } else {
                        snapshot.selected_session.as_ref()
                    }
                });
                if let Some(session) = session {
                    if session.can_close {
                        self.confirm_close = Some(session.id.clone());
                    } else {
                        self.error = Some(
                            "only open sessions with no pending/running jobs can be closed".into(),
                        );
                    }
                }
            }
            JobsKey::Char('r') if self.detail_id.is_some() && !self.retrying => {
                if self
                    .snapshot
                    .as_ref()
                    .and_then(|s| s.detail.as_ref())
                    .and_then(|d| d.get("status"))
                    .and_then(Value::as_str)
                    == Some("Failed")
                {
                    self.confirm_retry = true;
                } else {
                    self.invalidate();
                }
            }
            JobsKey::Char('r') => self.invalidate(),
            _ => {}
        }
        None
    }
}

pub fn duration(seconds: u64) -> String {
    if seconds < 60 {
        format!("{seconds}s")
    } else if seconds < 3600 {
        format!("{}m{:02}s", seconds / 60, seconds % 60)
    } else {
        format!("{}h{:02}m", seconds / 3600, seconds / 60 % 60)
    }
}

pub fn spinner(now: i64) -> char {
    ['|', '/', '-', '\\'][now.rem_euclid(4) as usize]
}

pub fn timestamp(at: Option<i64>, now: i64) -> String {
    let Some(at) = at.filter(|at| *at > 0) else {
        return "time unknown".into();
    };
    let absolute = match time::OffsetDateTime::from_unix_timestamp(at) {
        Ok(date) => date,
        Err(_) => return "invalid timestamp".into(),
    };
    let age = now.saturating_sub(at).max(0);
    let relative = match age {
        0..10 => "just now".into(),
        10..60 => format!("{age}s ago"),
        60..3600 => format!("{}m ago", age / 60),
        3600..86400 => format!("{} hours ago", age / 3600),
        86400..604800 => format!("{} days ago", age / 86400),
        604800..1209600 => "last week".into(),
        1209600..2592000 => format!("{} weeks ago", age / 604800),
        2592000..5184000 => "last month".into(),
        5184000..31536000 => format!("{} months ago", age / 2592000),
        _ => format!("{} years ago", age / 31536000),
    };
    format!(
        "{relative} · {:04}-{:02}-{:02} {:02}:{:02} UTC",
        absolute.year(),
        u8::from(absolute.month()),
        absolute.day(),
        absolute.hour(),
        absolute.minute()
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn response() -> DispatchResponse {
        DispatchResponse {
            success: true,
            message: String::new(),
            data: Some(json!({
                "stats":{"running":1,"pending":50,"failed":1,"completed":2,"cancelled":0,"sessions":1},
                "groups":[], "jobs":[{
                    "id":"job","session_id":"session","job_type":"RegenerateVideoPosters","status":"Running",
                    "scheduled_at":90,"started_at":100,"completed_at":null,"retry_count":0,"max_retries":0,
                    "error_message":null,"stage":"posters","message":"processing", "checked":5,"total":10,
                }], "active_jobs":[], "sessions":[], "total":51, "page":0,"page_size":20,
                "detail":{"id":"job","status":"Failed","error_message":"disk gone"},
                "detail_summary":null,
            })),
        }
    }

    fn sessions_response() -> DispatchResponse {
        let mut reply = response();
        reply.data.as_mut().unwrap()["sessions"] = json!([
            {"id":"session-a","job_type":"RegenerateVideoPosters","status":"Running",
             "progress":null,"pending":1,"running":1,"completed":0,"failed":0,"cancelled":0},
            {"id":"session-b","job_type":"ScanDirectory","status":"Completed",
             "progress":null,"pending":0,"running":0,"completed":3,"failed":0,"cancelled":0}
        ]);
        reply
    }

    #[test]
    fn overview_tab_and_shift_tab_focus_sessions_and_enter_opens_their_jobs() {
        let mut view = JobsView::default();
        view.receive(0, sessions_response());
        let mut focus = Focus::JobsView;
        view.key(JobsKey::Tab, &mut focus);
        assert!(view.sessions_focused());
        assert_eq!(view.row_count(), 2);
        assert_eq!(view.generation, 0);
        view.key(JobsKey::Down, &mut focus);
        assert_eq!(view.selected_id(), Some("session-b"));
        view.key(JobsKey::BackTab, &mut focus);
        assert!(!view.sessions_focused());
        assert_eq!(view.selected_id(), Some("job"));
        view.key(JobsKey::BackTab, &mut focus);
        view.key(JobsKey::Down, &mut focus);
        view.key(JobsKey::Enter, &mut focus);
        assert_eq!(view.session_id.as_deref(), Some("session-b"));
        assert_eq!(TABS[view.tab], "all");
        assert!(view.detail_id.is_none());
        assert_eq!(focus, Focus::JobsView);
    }

    #[test]
    fn overview_session_selection_survives_poll_reordering_and_empty_running_work() {
        let mut view = JobsView::default();
        view.receive(0, sessions_response());
        let mut focus = Focus::JobsView;
        view.key(JobsKey::Tab, &mut focus);
        view.key(JobsKey::Down, &mut focus);
        let mut reply = sessions_response();
        let data = reply.data.as_mut().unwrap();
        data["sessions"].as_array_mut().unwrap().swap(0, 1);
        data["jobs"] = json!([]);
        view.receive(0, reply);
        assert_eq!(view.selected_id(), Some("session-b"));
        assert_eq!(view.cursor, 0);
        view.key(JobsKey::Enter, &mut focus);
        assert_eq!(view.session_id.as_deref(), Some("session-b"));
    }

    #[test]
    fn bulk_close_requires_confirmation_and_reports_count_after_refresh() {
        let mut view = JobsView::default();
        view.receive(0, sessions_response());
        let mut focus = Focus::JobsView;
        assert!(view.key(JobsKey::Char('X'), &mut focus).is_none());
        assert!(view.confirm_close_all);
        assert!(view.key(JobsKey::Escape, &mut focus).is_none());
        assert!(!view.confirm_close_all);
        view.key(JobsKey::Char('X'), &mut focus);
        assert_eq!(
            view.key(JobsKey::Enter, &mut focus),
            Some(json!({"all_idle_sessions": true, "confirm": true}))
        );
        assert!(view.retrying);
        assert!(view.key(JobsKey::Char('X'), &mut focus).is_none());
        assert!(!view.confirm_close_all);
        assert!(view.key(JobsKey::Enter, &mut focus).is_none());
        view.receive_mutation(
            view.generation,
            DispatchResponse {
                success: true,
                message: "idle sessions closed".into(),
                data: Some(json!({"closed_sessions": 12})),
            },
        );
        assert!(!view.retrying);
        assert!(view
            .mutation_notice
            .as_deref()
            .unwrap()
            .contains("closed 12 idle sessions"));
        view.receive(view.generation, sessions_response());
        assert!(view
            .mutation_notice
            .as_deref()
            .unwrap()
            .contains("closed 12 idle sessions"));
        view.key(JobsKey::Char('X'), &mut focus);
        view.invalidate();
        assert!(!view.confirm_close_all);
    }

    #[test]
    fn idle_session_closure_requires_confirmation_and_live_sessions_are_not_closable() {
        let mut view = JobsView::default();
        let mut reply = sessions_response();
        reply.data.as_mut().unwrap()["sessions"][1]["can_close"] = json!(true);
        view.receive(0, reply);
        let mut focus = Focus::JobsView;
        view.key(JobsKey::Tab, &mut focus);
        view.key(JobsKey::Char('x'), &mut focus);
        assert!(view.confirm_close.is_none());
        assert!(view
            .error
            .as_deref()
            .unwrap()
            .contains("no pending/running"));
        view.key(JobsKey::Down, &mut focus);
        assert!(view.key(JobsKey::Char('x'), &mut focus).is_none());
        assert_eq!(view.confirm_close.as_deref(), Some("session-b"));
        view.key(JobsKey::Char('n'), &mut focus);
        assert!(view.confirm_close.is_none());
        view.key(JobsKey::Char('x'), &mut focus);
        assert_eq!(
            view.key(JobsKey::Enter, &mut focus).unwrap()["session_id"],
            "session-b"
        );
        assert!(view.key(JobsKey::Char('x'), &mut focus).is_none());
    }

    #[test]
    fn record_timestamps_are_short_relative_and_absolute_and_durations_are_frozen() {
        let now = 1_793_937_600;
        for (age, relative) in [
            (0, "just now"),
            (30, "30s ago"),
            (600, "10m ago"),
            (21600, "6 hours ago"),
            (172800, "2 days ago"),
            (604800, "last week"),
            (2592000, "last month"),
        ] {
            let text = timestamp(Some(now - age), now);
            assert!(text.contains(relative), "{text}");
            assert!(text.contains("2026-"), "{text}");
            assert!(text.ends_with("UTC"), "{text}");
        }
        assert_eq!(timestamp(None, now), "time unknown");
        let snapshot: Snapshot = serde_json::from_value(response().data.unwrap()).unwrap();
        let mut job = snapshot.jobs[0].clone();
        job.status = "Completed".into();
        job.completed_at = Some(130);
        assert!(job.progress(1000).contains("ran for 30s"));
        job.completed_at = None;
        assert!(job.progress(1000).contains("duration unknown"));
    }

    #[test]
    fn bare_jobs_and_stats_open_the_same_dashboard_and_subcommands_filter() {
        use crate::ratcore::slash::{parse, SlashAction};
        assert_eq!(parse("/jobs"), parse("/jobs stats"));
        assert!(matches!(parse("/jobs"),SlashAction::Jobs { view,.. } if view=="overview"));
        assert!(
            matches!(parse("/jobs failed disk offline"),SlashAction::Jobs { view,query,.. }
            if view=="Failed" && query=="disk offline")
        );
        assert!(
            matches!(parse("/jobs session abc"),SlashAction::Jobs { session_id:Some(id),.. } if id=="abc")
        );
        assert!(
            matches!(parse("/maintenance regenerate-video-posters"),SlashAction::AdminDispatch { name,.. }
            if name=="maintenance_regenerate_library_video_thumbnails")
        );
    }

    #[test]
    fn polling_is_bounded_and_discards_old_filters_and_remote_replies() {
        let mut view = JobsView::default();
        let (generation, _) = view.poll(100_000, None, true).unwrap();
        assert!(view.poll(101_000, None, true).is_none());
        view.receive(generation, response());
        assert!(view.poll(101_999, None, true).is_none());
        assert!(view.poll(102_000, None, true).is_some());
        view.open("Failed", String::new(), None);
        view.receive(generation, response());
        assert!(view.snapshot.is_none());
        let (new_generation, _) = view.poll(103_000, Some("peer".into()), true).unwrap();
        view.receive(new_generation, response());
        assert!(view.snapshot.is_some());
        assert!(view
            .poll(104_000, Some("other-peer".into()), true)
            .is_some());
        assert!(view.snapshot.is_none());
    }

    #[test]
    fn selection_details_search_and_retry_confirmation_are_navigable() {
        let mut view = JobsView::default();
        view.receive(0, response());
        let mut focus = Focus::JobsView;
        assert!(view.key(JobsKey::Enter, &mut focus).is_none());
        assert_eq!(view.detail_id.as_deref(), Some("job"));
        view.key(JobsKey::Char('r'), &mut focus);
        assert!(view.confirm_retry);
        assert!(view.key(JobsKey::Char('n'), &mut focus).is_none());
        assert!(!view.confirm_retry);
        view.key(JobsKey::Char('r'), &mut focus);
        assert_eq!(
            view.key(JobsKey::Enter, &mut focus).unwrap()["job_id"],
            "job"
        );
        view.key(JobsKey::Escape, &mut focus);
        assert!(view.detail_id.is_none());
        view.key(JobsKey::Char('f'), &mut focus);
        view.key(JobsKey::Char('/'), &mut focus);
        assert_eq!(view.query, "/");
        view.key(JobsKey::Enter, &mut focus);
        assert!(!view.editing);
    }

    #[test]
    fn eta_requires_measurable_progress_and_unknown_work_is_not_zero_percent() {
        let snapshot: Snapshot = serde_json::from_value(response().data.unwrap()).unwrap();
        let mut job = snapshot.jobs[0].clone();
        assert_eq!(job.progress(110), "50%  running for 10s ~10s left");
        job.total = None;
        assert!(job.progress(110).contains("eta unknown"));
        job.total = Some(0);
        assert!(!job.progress(110).contains("0%"));
        job.total = Some(2);
        assert_eq!(job.progress(110), "100%  running for 10s");
    }

    #[test]
    fn failure_is_visible_and_does_not_block_future_polls() {
        let mut view = JobsView::default();
        let (generation, _) = view.poll(100_000, None, true).unwrap();
        view.receive(
            generation,
            DispatchResponse {
                success: false,
                message: "offline".into(),
                data: None,
            },
        );
        assert_eq!(view.error.as_deref(), Some("offline"));
        assert!(!view.loading);
        assert!(view.poll(109_999, None, true).is_none());
        assert!(view.poll(110_000, None, true).is_some());
    }

    #[test]
    fn retry_cannot_be_double_dispatched_and_stale_replies_do_not_change_the_view() {
        let mut view = JobsView::default();
        view.receive(0, response());
        let mut focus = Focus::JobsView;
        view.key(JobsKey::Enter, &mut focus);
        view.key(JobsKey::Char('r'), &mut focus);
        assert!(view.key(JobsKey::Enter, &mut focus).is_some());
        let generation = view.generation;
        assert!(view.key(JobsKey::Char('r'), &mut focus).is_none());
        assert!(view.key(JobsKey::Enter, &mut focus).is_none());
        assert!(view.retrying);
        view.open("Pending", String::new(), None);
        view.receive_mutation(
            generation,
            DispatchResponse {
                success: false,
                message: "stale failure".into(),
                data: None,
            },
        );
        assert!(view.error.is_none());
        assert!(!view.retrying);
    }
}
