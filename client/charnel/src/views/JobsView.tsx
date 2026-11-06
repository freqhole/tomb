import { createEffect, createSignal, For, on, onCleanup, Show } from "solid-js";
import { useSearchParams } from "@solidjs/router";
import { useAdminTransport } from "../admin/context";
import { jobDuration, jobProgress, jobTimestamp, useJobs, type Dashboard } from "../jobs";
import OptionSelect from "../components/OptionSelect";

const TABS = [
  "overview",
  "Running",
  "Pending",
  "Failed",
  "Completed",
  "sessions",
  "all",
  "Cancelled",
];

export default function JobsView() {
  const admin = useAdminTransport();
  const tracker = useJobs();
  const [params] = useSearchParams();
  const [view, setView] = createSignal("overview");
  const [query, setQuery] = createSignal("");
  const [searchOpen, setSearchOpen] = createSignal(false);
  const [jobType, setJobType] = createSignal<string | null>(null);
  const [session, setSession] = createSignal<string | null>(null);
  const [jobId, setJobId] = createSignal<string | null>(null);
  const [page, setPage] = createSignal(0);
  const [data, setData] = createSignal<Dashboard | null>(null);
  const [error, setError] = createSignal("");
  const [loading, setLoading] = createSignal(false);
  const [confirmRetry, setConfirmRetry] = createSignal(false);
  const [retrying, setRetrying] = createSignal(false);
  const [confirmClose, setConfirmClose] = createSignal(false);
  const [closing, setClosing] = createSignal(false);
  const [confirmCloseAll, setConfirmCloseAll] = createSignal(false);
  const [mutationError, setMutationError] = createSignal("");
  const [notice, setNotice] = createSignal("");
  const [now, setNow] = createSignal(Date.now() / 1000);
  const clock = setInterval(() => setNow(Date.now() / 1000), 1000);
  let request = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  async function refresh() {
    const current = ++request;
    const target = admin.current();
    const args = {
      view: view(),
      query: query(),
      session_id: session(),
      page: page(),
      job_id: jobId(),
      job_type: jobType(),
    };
    setLoading(true);
    try {
      const next = await admin.dispatchOrThrow<Dashboard>("jobs_dashboard", args);
      if (disposed || current !== request || admin.current() !== target) return;
      setData(next);
      setPage(next.page);
      setError("");
    } catch (e) {
      if (!disposed && current === request && admin.current() === target)
        setError(`could not refresh jobs: ${e}`);
    } finally {
      if (!disposed && current === request) setLoading(false);
    }
  }

  function schedule() {
    if (timer !== undefined) return;
    timer = setTimeout(() => {
      timer = undefined;
      void refresh();
    }, 250);
  }

  createEffect(
    on(
      () => params.job,
      (id) => setJobId(typeof id === "string" ? id : null),
    ),
  );
  createEffect(
    on(
      () => [view(), query(), jobType(), session(), page(), jobId(), admin.current()],
      () => {
        request++;
        setConfirmRetry(false);
        setConfirmClose(false);
        setConfirmCloseAll(false);
        setData(null);
        schedule();
      },
    ),
  );
  createEffect(on(tracker.revision, schedule));
  createEffect(
    on(
      admin.current,
      () => {
        setSession(null);
        setJobId(null);
        setPage(0);
        setError("");
        setMutationError("");
        setNotice("");
        setJobType(null);
        setQuery("");
        setSearchOpen(false);
      },
      { defer: true },
    ),
  );
  onCleanup(() => {
    disposed = true;
    request++;
    clearTimeout(timer);
    clearInterval(clock);
  });

  async function retry() {
    if (retrying() || !jobId()) return;
    const target = admin.current();
    const id = jobId();
    setRetrying(true);
    setConfirmRetry(false);
    try {
      await admin.dispatchOrThrow("jobs_retry", { job_id: id, confirm: true });
      if (disposed || admin.current() !== target || jobId() !== id) return;
      await refresh();
    } catch (e) {
      if (!disposed && admin.current() === target && jobId() === id)
        setError(`could not retry job: ${e}`);
    } finally {
      if (!disposed) setRetrying(false);
    }
  }

  async function closeSession() {
    const id = session();
    if (!id || closing()) return;
    const target = admin.current();
    setClosing(true);
    setConfirmClose(false);
    setMutationError("");
    setNotice("");
    try {
      await admin.dispatchOrThrow("jobs_close_idle_session", { session_id: id, confirm: true });
      if (!disposed && admin.current() === target && session() === id) {
        setNotice(`closed session ${id}; removed from the overview. history is preserved.`);
        await refresh();
      }
    } catch (e) {
      if (!disposed && admin.current() === target && session() === id)
        setMutationError(`could not close idle session: ${e}`);
    } finally {
      if (!disposed) setClosing(false);
    }
  }

  async function closeAllSessions() {
    if (closing()) return;
    const target = admin.current();
    setClosing(true);
    setConfirmCloseAll(false);
    setMutationError("");
    setNotice("");
    try {
      const result = await admin.dispatchOrThrow<{ closed_sessions: number }>(
        "jobs_close_idle_sessions",
        { confirm: true },
      );
      if (disposed || admin.current() !== target) return;
      setNotice(
        `closed ${result.closed_sessions} idle sessions; history is preserved. running and pending work was left alone.`,
      );
      await refresh();
    } catch (e) {
      if (!disposed && admin.current() === target)
        setMutationError(`could not close idle sessions: ${e}`);
    } finally {
      if (!disposed) setClosing(false);
    }
  }

  return (
    <div class="jobs-view">
      <h1>jobs</h1>
      <p class="hint">
        live events from the selected library. counts cover retained jobs, not a complete history.
      </p>
      <Show when={tracker.error()}>
        <p class="scan-progress error">{tracker.error()} · displayed data may be stale</p>
        <button class="secondary" onClick={() => void tracker.reconnect().catch(console.error)}>
          reconnect progress
        </button>
      </Show>
      <Show when={error()}>
        <p class="scan-progress error" role="alert">
          {error()}
        </p>
      </Show>
      <Show when={mutationError()}>
        <p class="scan-progress error" role="alert">
          {mutationError()}
        </p>
      </Show>
      <Show when={notice()}>
        <p class="scan-progress-card success" role="status">
          {notice()}
        </p>
      </Show>
      <div class="jobs-toolbar">
        <OptionSelect
          aria-label="jobs view"
          value={view()}
          options={TABS.map((tab) => ({ value: tab, label: tab.toLowerCase() }))}
          onChange={(tab) => {
            setView(tab);
            setPage(0);
            setJobId(null);
          }}
        />
        <button
          class="secondary jobs-icon-button"
          aria-label="toggle job search"
          title="search jobs"
          aria-expanded={searchOpen()}
          onClick={() => setSearchOpen(!searchOpen())}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="10" cy="10" r="6" />
            <path d="m15 15 6 6" />
          </svg>
        </button>
        <Show when={searchOpen()}>
          <input
            class="jobs-search"
            aria-label="search jobs"
            placeholder="search jobs..."
            value={query()}
            maxLength={256}
            onInput={(e) => {
              setQuery(e.currentTarget.value);
              setPage(0);
            }}
          />
        </Show>
        <Show when={query() && !searchOpen()}>
          <span class="hint">search: {query()}</span>
        </Show>
        <Show when={session()}>
          <span>session {session()}</span>
        </Show>
        <Show when={query() || session() || jobType()}>
          <button
            class="secondary small"
            onClick={() => {
              setQuery("");
              setSession(null);
              setJobType(null);
              setPage(0);
            }}
          >
            clear filters
          </button>
        </Show>
        <Show when={jobType()}>
          <span class="hint">type: {jobType()}</span>
        </Show>
        <button
          class="secondary jobs-icon-button"
          aria-label="refresh jobs"
          title="refresh jobs"
          disabled={loading()}
          onClick={() => void refresh()}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M20 7v5h-5M20 12a8 8 0 1 0-2 5M20 7l-3-3" />
          </svg>
        </button>
      </div>
      <Show when={data()} fallback={<p>loading jobs...</p>}>
        {(snapshot) => (
          <>
            <Show
              when={jobId()}
              fallback={
                <>
                  <Show when={view() === "overview"}>
                    <div class="scan-progress-card">
                      <h2>work by type</h2>
                      <For
                        each={snapshot()
                          .groups.filter((g) => ["Running", "Pending", "Failed"].includes(g.status))
                          .slice(0, 6)}
                      >
                        {(group) => (
                          <p>
                            <a
                              href="#/jobs"
                              onClick={(e) => {
                                e.preventDefault();
                                setView(group.status);
                                setJobType(group.job_type);
                                setSession(null);
                                setQuery("");
                                setPage(0);
                              }}
                            >
                              {group.job_type}: {group.count} {group.status.toLowerCase()}
                            </a>
                          </p>
                        )}
                      </For>
                    </div>
                    <h2>running jobs</h2>
                  </Show>
                  <Show when={snapshot().selected_session}>
                    {(selected) => (
                      <section class="scan-progress-card jobs-session-detail">
                        <h2>session {selected().id.slice(0, 12)}</h2>
                        <p>
                          {selected().status.toLowerCase()}
                          {selected().closed ? " (closed)" : ""} · {selected().running} running ·{" "}
                          {selected().pending} pending
                        </p>
                        <p>last activity: {jobTimestamp(selected().updated_at, now())}</p>
                        <p>created: {jobTimestamp(selected().created_at, now())}</p>
                        <Show when={selected().started_at != null && selected().ended_at != null}>
                          <p>
                            run span:{" "}
                            {jobDuration(
                              Math.max(0, selected().ended_at! - selected().started_at!),
                            )}
                          </p>
                        </Show>
                        <Show when={selected().can_close}>
                          <Show
                            when={confirmClose()}
                            fallback={
                              <button
                                class="secondary small"
                                disabled={closing()}
                                onClick={() => setConfirmClose(true)}
                              >
                                close idle session
                              </button>
                            }
                          >
                            <p>
                              remove from the overview; keep history and failure details. no
                              pending/running jobs. this does not stop a multi-step workflow from
                              adding later jobs; close only if that workflow has finished.
                            </p>
                            <button
                              class="secondary small"
                              disabled={closing()}
                              onClick={() => void closeSession()}
                            >
                              confirm close
                            </button>
                            <button class="secondary small" onClick={() => setConfirmClose(false)}>
                              cancel
                            </button>
                          </Show>
                        </Show>
                      </section>
                    )}
                  </Show>
                  <Show when={view() !== "sessions"}>
                    <div class="jobs-list">
                      <For each={snapshot().jobs} fallback={<p>no matching jobs</p>}>
                        {(job) => (
                          <button class="job-list-row secondary" onClick={() => setJobId(job.id)}>
                            <strong>{job.job_type}</strong>
                            <span>{job.skipped ? "skipped" : job.status.toLowerCase()}</span>
                            <span>{jobProgress(job, now())}</span>
                            <code>{job.id.slice(0, 12)}</code>
                            <span class="job-list-message">
                              {job.status === "Running"
                                ? "started"
                                : job.completed_at !== null
                                  ? "finished"
                                  : "queued"}
                              :{" "}
                              {jobTimestamp(
                                job.completed_at ?? job.started_at ?? job.scheduled_at,
                                now(),
                              )}
                            </span>
                            <span class="job-list-message">
                              last activity: {jobTimestamp(job.last_activity_at, now())} (
                              {job.activity_source ?? "lifecycle timestamp"})
                            </span>
                            <span class="job-list-message">
                              {job.error_message || job.message || job.stage}
                            </span>
                          </button>
                        )}
                      </For>
                    </div>
                  </Show>
                  <Show when={view() === "sessions" || view() === "overview"}>
                    <h2>{view() === "overview" ? "open sessions" : "session history"}</h2>
                    <Show when={snapshot().sessions.length > 0}>
                      <Show
                        when={confirmCloseAll()}
                        fallback={
                          <button
                            class="secondary small"
                            disabled={closing()}
                            onClick={() => setConfirmCloseAll(true)}
                          >
                            {closing() ? "closing sessions..." : "close all idle sessions"}
                          </button>
                        }
                      >
                        <p>
                          close all idle sessions in this library, including those not shown here?
                          history and failure details are kept; pending/running sessions are
                          skipped.
                        </p>
                        <button
                          class="secondary small"
                          disabled={closing()}
                          onClick={() => void closeAllSessions()}
                        >
                          confirm close all
                        </button>
                        <button class="secondary small" onClick={() => setConfirmCloseAll(false)}>
                          cancel
                        </button>
                      </Show>
                    </Show>
                    <div class="jobs-list">
                      <For each={snapshot().sessions} fallback={<p>no matching sessions</p>}>
                        {(item) => (
                          <button
                            class="job-list-row secondary"
                            onClick={() => {
                              setSession(item.id);
                              setView("all");
                              setPage(0);
                            }}
                          >
                            <strong>{item.job_type}</strong>
                            <span>
                              {item.status.toLowerCase()}
                              {item.closed ? " (closed)" : ""}
                            </span>
                            <code>{item.id.slice(0, 12)}</code>
                            <span class="job-list-message">
                              {item.running} running · {item.pending} pending · {item.completed}{" "}
                              completed · {item.failed} failed
                            </span>
                            <span class="job-list-message">
                              last activity: {jobTimestamp(item.updated_at, now())}
                            </span>
                          </button>
                        )}
                      </For>
                    </div>
                  </Show>
                  <Show when={view() !== "overview"}>
                    <div class="button-row">
                      <button
                        class="secondary small"
                        disabled={snapshot().page === 0 || loading()}
                        onClick={() => setPage(page() - 1)}
                      >
                        previous
                      </button>
                      <span>
                        page {snapshot().page + 1} · {snapshot().total} matching
                      </span>
                      <button
                        class="secondary small"
                        disabled={
                          (snapshot().page + 1) * snapshot().page_size >= snapshot().total ||
                          loading()
                        }
                        onClick={() => setPage(page() + 1)}
                      >
                        next
                      </button>
                    </div>
                  </Show>
                </>
              }
            >
              <button class="secondary small" onClick={() => setJobId(null)}>
                back to jobs
              </button>
              <Show
                when={snapshot().detail}
                fallback={<p>job no longer exists; completed scan jobs may be pruned</p>}
              >
                {(detail) => (
                  <section class="scan-progress-card job-details">
                    <h2>{detail().job_type}</h2>
                    <code>{detail().id}</code>
                    <p>
                      {snapshot().detail_summary?.skipped
                        ? "skipped"
                        : detail().status.toLowerCase()}{" "}
                      ·{" "}
                      {snapshot().detail_summary
                        ? jobProgress(snapshot().detail_summary!, now())
                        : "progress unknown"}
                    </p>
                    <p>{snapshot().detail_summary?.message}</p>
                    <p>queued: {jobTimestamp(detail().scheduled_at, now())}</p>
                    <Show when={detail().started_at !== null}>
                      <p>started: {jobTimestamp(detail().started_at!, now())}</p>
                    </Show>
                    <Show when={detail().completed_at !== null}>
                      <p>finished: {jobTimestamp(detail().completed_at!, now())}</p>
                    </Show>
                    <p>
                      last activity:{" "}
                      {jobTimestamp(snapshot().detail_summary?.last_activity_at, now())} (
                      {snapshot().detail_summary?.activity_source ?? "lifecycle timestamp"})
                    </p>
                    <Show when={detail().error_message}>
                      <p class="scan-progress error">{detail().error_message}</p>
                    </Show>
                    <p>
                      retry count / limit: {detail().retry_count} / {detail().max_retries}
                    </p>
                    <Show when={detail().status === "Failed"}>
                      <Show
                        when={confirmRetry()}
                        fallback={
                          <button
                            class="secondary"
                            disabled={retrying()}
                            onClick={() => setConfirmRetry(true)}
                          >
                            {retrying() ? "requeueing..." : "retry failed job"}
                          </button>
                        }
                      >
                        <p>
                          retry clears the previous error/result and may repeat side effects or
                          child jobs.
                        </p>
                        <button
                          class="secondary"
                          disabled={retrying()}
                          onClick={() => void retry()}
                        >
                          confirm retry
                        </button>
                        <button class="secondary" onClick={() => setConfirmRetry(false)}>
                          cancel
                        </button>
                      </Show>
                    </Show>
                    <h3>parameters</h3>
                    <pre>{pretty(detail().parameters)}</pre>
                    <h3>result / structured errors</h3>
                    <pre>{pretty(detail().result)}</pre>
                  </section>
                )}
              </Show>
            </Show>
          </>
        )}
      </Show>
    </div>
  );
}

function pretty(raw: string | null) {
  if (raw === null) return "none";
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}
