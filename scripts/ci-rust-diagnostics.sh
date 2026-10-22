#!/usr/bin/env bash
# temporary Linux runner diagnostics; keep the wrapped command's exit status.
set -uo pipefail

if [ "$#" -eq 0 ]; then
  echo "usage: bash scripts/ci-rust-diagnostics.sh command [args...]" >&2
  exit 2
fi

if [ "$(uname -s)" != Linux ]; then
  echo "CI resource diagnostics require Linux" >&2
  exit 2
fi

cgroup_dir=/sys/fs/cgroup
while IFS=: read -r hierarchy controllers relative_path; do
  if [ "$hierarchy" = 0 ] && [ -z "$controllers" ]; then
    candidate="/sys/fs/cgroup${relative_path}"
    if [ -d "$candidate" ]; then
      cgroup_dir="$candidate"
    fi
    break
  fi
done < /proc/self/cgroup
cgroup_dirs=(/sys/fs/cgroup)
if [ "$cgroup_dir" != /sys/fs/cgroup ]; then
  cgroup_dirs+=("$cgroup_dir")
fi

snapshot() {
  printf '\n--- CI resource snapshot: %s ---\n' "$(date -u +%FT%TZ)"
  free -m || echo "unable to read memory usage"
  df -h . || echo "unable to read workspace disk usage"
  df -i . || echo "unable to read workspace inode usage"
  ps -eo pid,ppid,rss,pcpu,stat,comm --sort=-rss | head -n 16
  for directory in "${cgroup_dirs[@]}"; do
    for metric in memory.current memory.peak memory.max memory.events memory.swap.current memory.swap.max; do
      if [ -r "$directory/$metric" ]; then
        printf '%s: ' "$directory/$metric"
        cat "$directory/$metric"
      else
        printf '%s: unavailable\n' "$directory/$metric"
      fi
    done
  done
  kernel_messages
}

monitor() {
  local sleeper=
  trap 'if [ -n "$sleeper" ]; then kill "$sleeper" 2>/dev/null; wait "$sleeper" 2>/dev/null; fi; exit 0' TERM INT
  while true; do
    snapshot
    sleep 15 &
    sleeper=$!
    wait "$sleeper"
    sleeper=
  done
}

kernel_messages() {
  local output
  # read-only, noninteractive sudo; kernel access may be restricted by the host.
  if output=$(sudo -n dmesg --ctime 2>&1); then
    printf '%s\n' "$output" | tail -n 60
  else
    echo "kernel diagnostics unavailable:"
    printf '%s\n' "$output"
  fi
}

monitor_pid=
cleanup() {
  local status=$?
  trap - EXIT
  if [ -n "$monitor_pid" ]; then
    kill "$monitor_pid" 2>/dev/null || echo "resource monitor already stopped"
    wait "$monitor_pid" 2>/dev/null
  fi
  printf '\n--- wrapped command exit status: %s ---\n' "$status"
  snapshot
  exit "$status"
}
trap cleanup EXIT
trap 'echo "diagnostic wrapper received SIGTERM"; exit 143' TERM
trap 'echo "diagnostic wrapper received SIGINT"; exit 130' INT

printf 'runner: %s; CPUs: %s; cgroup: %s\n' "$(uname -srmo)" "$(nproc)" "$cgroup_dir"
printf 'wrapped command:'
printf ' %q' "$@"
printf '\n'
monitor &
monitor_pid=$!
/usr/bin/time -v "$@"
