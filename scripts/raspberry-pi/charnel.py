"""charnel updates and optional menu configuration; always run as the app account."""

import argparse
import fcntl
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import tempfile
import time
import tomllib

import configure
import packages


ROOT = Path.home() / ".local/share/freqhole-pi"
TRANSACTION = ROOT / "charnel-transaction.json"
PACKAGE_HELPER = "/usr/local/libexec/freqhole-pi-packages"
MARKER = "# managed by freqhole-pi setup"
SAFE_PHASES = ("complete", "recovered", "failed-before-install")
MIGRATIONS = ("haruspex_migration", "reliquary_migration", "radio_encode_args_migration",
              "blake3_backfill_migration", "contentless_blob_cleanup_migration")


class ConfigNotReady(ValueError):
    pass


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, delete=False) as output:
        temporary = Path(output.name)
        try:
            json.dump(data, output, indent=2)
            output.flush()
            os.fsync(output.fileno())
            temporary.chmod(0o600)
            temporary.replace(path)
            packages.sync_directory(path.parent)
        finally:
            temporary.unlink(missing_ok=True)


def settings():
    return json.loads((ROOT / "installation.json").read_text())


def config_path(installation):
    data = Path(installation["charnel_data"]).resolve()
    app_config = data / "charnel-config.toml"
    if app_config.exists():
        saved = tomllib.loads(app_config.read_text()).get("server_config_path")
        if saved:
            candidate = Path(saved)
            if candidate.is_relative_to(data) and candidate.is_file():
                return candidate.resolve()
    fallback = data / "freqhole-config.toml"
    if fallback.is_file():
        return fallback
    raise ConfigNotReady("complete charnel's first-run wizard before updating or configuring its socket")


def prepare_launch(installation):
    if TRANSACTION.exists():
        phase = json.loads(TRANSACTION.read_text())["phase"]
        if phase not in (*SAFE_PHASES, "ready-to-start"):
            raise ValueError("an unfinished charnel update blocks startup; run freqhole-pi recover charnel")
    if installation.get("menu_player") == "charnel":
        prepare_socket(installation)
    prepare_pairing(installation)


def prepare_pairing(installation):
    """turns on `[player_pairing].enabled` once for Pi player installs.

    the server config only exists after charnel's first-run wizard, so setup
    records the choice and this applies it on the first launch that finds a
    config. it's applied once: turning pairing off later in charnel sticks."""
    if installation.get("player_pairing") != "pending":
        return
    try:
        path = config_path(installation)
    except ConfigNotReady:
        return
    try:
        configure.edit(path, configure.pairing_config)
        installation["player_pairing"] = "applied"
        write_json(ROOT / "installation.json", installation)
    except (OSError, ValueError) as error:
        # never block a launch or an update over a convenience setting.
        print(f"could not enable player pairing: {error}", flush=True)
        return
    print("charnel player pairing enabled for this Pi player.", flush=True)


def validate_migrations(result, version):
    if not isinstance(result, dict) or result.get("success") is not True:
        raise ValueError("config upgrade did not report success")
    data = result.get("data")
    if not isinstance(data, dict) or data.get("new_version") != version:
        raise ValueError("config upgrade returned an unexpected version/result")
    unknown = {key for key in data if key.endswith("_migration")} - set(MIGRATIONS)
    if unknown:
        raise ValueError(f"update the Pi scripts to handle new migration results: {sorted(unknown)}")
    for name in MIGRATIONS:
        outcome = data.get(name)
        if not isinstance(outcome, dict):
            raise ValueError(f"config upgrade omitted {name}")
        status = outcome.get("status")
        if status == "ran":
            report = outcome.get("report")
            if not isinstance(report, dict):
                raise ValueError(f"{name}: missing migration report")
            issues = {
                "haruspex_migration": ("unresolved_user_refs", "unexpected_knock_status"),
                "reliquary_migration": ("unresolved_parents", "missing_content", "unmigrated_blob_data"),
            }
            for field in issues.get(name, ()):
                expected = int if field == "unmigrated_blob_data" else list
                if type(report.get(field)) is not expected or report[field]:
                    raise ValueError(f"{name}: missing/non-clean verification field {field}; inspect upgrade.stdout")
            if name == "contentless_blob_cleanup_migration":
                if type(report.get("deletion_failures")) is not int or report["deletion_failures"] != 0:
                    raise ValueError("contentless blob cleanup reported missing/failed deletions")
            continue
        reason = outcome.get("reason")
        if status == "skipped" and isinstance(reason, str) and re.fullmatch(
            r"old config version \d+\.\d+\.\d+ is newer than \d+\.\d+\.\d+ - .+",
            reason,
        ):
            continue
        raise ValueError(f"{name}: {outcome.get('error') or outcome.get('reason') or 'invalid outcome'}")
    backfill = data["blake3_backfill_migration"]
    if backfill["status"] == "ran":
        cleanup = data["contentless_blob_cleanup_migration"]
        deleted = cleanup["report"].get("blobs_deleted") if cleanup["status"] == "ran" else 0
        remaining = backfill["report"].get("remaining")
        if type(remaining) is not int or type(deleted) is not int or remaining < 0 or remaining > deleted:
            raise ValueError("blake3 backfill left unresolved blobs after contentless cleanup")


def snapshot_roots(installation, config):
    parsed = tomllib.loads(config.read_text())
    data = Path(parsed["data_dir"])
    if not data.is_absolute():
        data = Path.home() / data
    roots = [Path(installation["charnel_data"]), Path(installation["charnel_config"]), data, config]
    database = parsed["database"]
    databases = []
    for filename, base in ((database["filename"], data), (database.get("reliquary_db_path"), Path.home())):
        if filename:
            path = Path(filename)
            databases.append((path if path.is_absolute() else base / path).resolve())
    filename = Path(database["filename"])
    databases.append((data / f"{filename.stem}-blobdata{filename.suffix or '.db'}").resolve())
    for path in databases:
        roots.extend((path, *(Path(str(path) + suffix) for suffix in ("-wal", "-shm", "-journal"))))
    resolved = sorted(set(path.resolve() for path in roots), key=lambda path: len(path.parts))
    selected = []
    for path in resolved:
        if ROOT.resolve().is_relative_to(path) or path == Path.home().resolve() or len(path.parts) < 3:
            raise ValueError(f"refusing overly broad/recursive backup root: {path}")
        if not any(path.is_relative_to(parent) for parent in selected):
            selected.append(path)
    return selected


def snapshot(roots, destination):
    destination.mkdir(mode=0o700)
    entries = []
    for index, source in enumerate(roots):
        target = destination / str(index)
        entry = {"source": str(source), "snapshot": str(target), "exists": source.exists()}
        if source.exists():
            if source.is_mount():
                raise ValueError(f"backup root is a mountpoint; use a dedicated subdirectory instead: {source}")
            # copies include configs, SQLite WALs, blob stores and any migration side effects.
            if source.is_dir():
                # external symlink targets would otherwise escape both backup and recovery.
                for item in source.rglob("*"):
                    if item.is_symlink():
                        raise ValueError(f"data/config contains a symlink; review its backup scope first: {item}")
                    if item.is_mount():
                        raise ValueError(f"data/config contains a nested mountpoint; review its backup scope first: {item}")
                shutil.copytree(source, target, ignore=lambda directory, names: [
                    name for name in names if stat.S_ISSOCK((Path(directory) / name).stat().st_mode)
                ])
            else:
                shutil.copy2(source, target)
        entries.append(entry)
    write_json(destination / "manifest.json", entries)
    # persist the snapshot before a package/migration can change the originals.
    packages.sync_tree(destination)
    return entries


def require_stopped():
    result = subprocess.run(["pgrep", "-x", "charnel|rathole|freqhole|server"], capture_output=True, text=True)
    if result.returncode == 0:
        raise ValueError("another charnel/rathole/freqhole/server process is running; stop other database writers first")
    if result.returncode != 1:
        raise ValueError("could not check for unmanaged charnel processes")


def require_unused(roots):
    databases = []
    for root in roots:
        for path in root.rglob("*") if root.is_dir() else (root,):
            if path.is_file():
                with path.open("rb") as source:
                    if source.read(16) == b"SQLite format 3\x00":
                        databases.append(str(path))
    for database in databases:
        result = subprocess.run(["lsof", "-t", "--", database], capture_output=True, text=True)
        if result.returncode == 0:
            raise ValueError(f"database still in use: {database}; stop other apps/CLI/server writers first")
        if result.returncode != 1 or result.stderr.strip():
            raise ValueError(f"could not verify exclusive database use: {database}: {result.stderr}")


def user_service(*arguments):
    return subprocess.run(["systemctl", "--user", *arguments, "charnel.service"],
                          check=True, capture_output=True, text=True).stdout.strip()


def require_managed(installation):
    unit = Path(installation["charnel_config"]).parent / "systemd/user/charnel.service"
    if MARKER not in unit.read_text():
        raise ValueError("charnel user service is not managed by Pi setup")


def package_action(action, version=None):
    command = ["sudo", "-n", PACKAGE_HELPER, f"charnel-{action}"]
    if version is not None:
        command.append(version)
    # prepare returns only a small JSON manifest; apt output remains visible during install/recovery.
    result = subprocess.run(command, check=True, text=True, capture_output=action == "prepare")
    return json.loads(result.stdout) if action == "prepare" else None


def restart(transaction):
    if transaction["was_running"]:
        user_service("start")
        time.sleep(2)
        if user_service("show", "--property=ActiveState", "--value") != "active":
            raise ValueError("charnel exited after restart; inspect journalctl --user -u charnel")


def cli_result(text):
    for index, line in enumerate(text.splitlines(keepends=True)):
        if line.startswith("{"):
            try:
                return json.loads("".join(text.splitlines(keepends=True)[index:]))
            except json.JSONDecodeError:
                continue
    raise ValueError("config upgrade returned no complete JSON result; inspect the saved upgrade logs")


def update(installation):
    require_managed(installation)
    config = config_path(installation)
    if TRANSACTION.exists() and json.loads(TRANSACTION.read_text())["phase"] not in SAFE_PHASES:
        raise ValueError("unfinished update; run freqhole-pi recover charnel before retrying")
    staged = package_action("prepare")
    if staged["update_available"] is False:
        print(f"charnel {staged['version']}: no newer stable release (available {staged['available']}).", flush=True)
        return
    version = staged["version"]
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise ValueError("invalid prepared version")
    state = user_service("show", "--property=ActiveState", "--value")
    if state not in ("active", "inactive", "failed"):
        raise ValueError(f"charnel service is transitioning: {state}")
    transaction = {
        "version": version, "previous": staged["previous"], "was_running": state == "active",
        "phase": "stopping", "config": str(config),
        "backup": str(ROOT / "backups" / f"{time.strftime('%Y%m%d-%H%M%S')}-{time.monotonic_ns()}"),
        "package_started": False,
    }
    write_json(TRANSACTION, transaction)
    package_started = False
    try:
        user_service("stop")
        require_stopped()
        backup = Path(transaction["backup"])
        backup.parent.mkdir(mode=0o700, exist_ok=True)
        print(f"snapshotting charnel data/config to {backup}; this can take space/time for large libraries.", flush=True)
        roots = snapshot_roots(installation, config)
        require_unused(roots)
        snapshot(roots, backup)
        transaction["phase"] = "installing"
        transaction["package_started"] = True
        write_json(TRANSACTION, transaction)
        package_started = True
        package_action("install", version)
        transaction["phase"] = "migrating"
        write_json(TRANSACTION, transaction)
        migration = subprocess.run(
            ["/usr/bin/charnel", "--config", str(config), "--json-output", "config", "upgrade"],
            cwd=Path.home(), capture_output=True, text=True,
        )
        (backup / "upgrade.stdout").write_text(migration.stdout)
        (backup / "upgrade.stderr").write_text(migration.stderr)
        migration.check_returncode()
        result = cli_result(migration.stdout)
        validate_migrations(result, version)
        prepare_socket(installation)
        prepare_pairing(installation)
        transaction["phase"] = "ready-to-start"
        write_json(TRANSACTION, transaction)
        restart(transaction)
        transaction["phase"] = "complete"
        write_json(TRANSACTION, transaction)
        print(f"charnel updated to {version}; backup retained at {backup}", flush=True)
    except (OSError, ValueError, KeyError, subprocess.SubprocessError, KeyboardInterrupt):
        transaction["phase"] = "failed" if package_started else "failed-before-install"
        write_json(TRANSACTION, transaction)
        try:
            user_service("stop")
        except subprocess.CalledProcessError as stop_error:
            print(f"could not stop charnel after failure: {stop_error.stderr or stop_error}", flush=True)
        print(f"charnel update failed. logs/backup: {transaction['backup']}. "
              "run freqhole-pi recover charnel.", flush=True)
        raise


def prepare_socket(installation):
    if not installation.get("hardware"):
        return
    player = installation["menu_player"]
    if player == "charnel":
        try:
            path = config_path(installation)
        except ConfigNotReady as error:
            print(f"{error}; select enable control socket in the wizard for OLED control.", flush=True)
            configure.update_menu_settings(ROOT / "menu.json", {
                "player": player, "socket_path": str(Path.home() / "rathole-control.sock"),
            })
            return
        cwd = Path.home()
    elif player == "rathole":
        path = ROOT / "freqhole-config.toml"
        if not path.exists():
            print("select enable control socket in rathole's first-run wizard for OLED control.", flush=True)
            configure.update_menu_settings(ROOT / "menu.json", {
                "player": player, "socket_path": str(Path.home() / "rathole-control.sock"),
            })
            return
        cwd = ROOT
    else:
        raise ValueError("invalid menu player")
    parsed = tomllib.loads(path.read_text())
    section = parsed.get("control_socket", {})
    if not section.get("enabled", False):
        print(f"{player} control socket is disabled; enable it in the app for OLED control.", flush=True)
        return
    socket = Path(section.get("socket_path") or Path.home() / "rathole-control.sock")
    if not socket.is_absolute():
        socket = cwd / socket
    socket = socket.absolute()
    if len(os.fsencode(socket)) >= 108 or not socket.parent.is_dir():
        raise ValueError(f"socket path is too long or its parent directory does not exist: {socket}")
    configure.update_menu_settings(ROOT / "menu.json", {"player": player, "socket_path": str(socket)})


def recover(installation):
    require_managed(installation)
    transaction = json.loads(TRANSACTION.read_text())
    if transaction["phase"] in ("complete", "recovered"):
        raise ValueError("no failed update to recover")
    user_service("stop")
    require_stopped()
    if transaction["package_started"]:
        backup = Path(transaction["backup"])
        entries = json.loads((backup / "manifest.json").read_text())
        require_unused([Path(entry["source"]) for entry in entries])
        # rollback only to the root-owned package retained by this transaction.
        package_action("rollback", transaction["version"])
        recovery_path = backup / "recovery.json"
        progress = json.loads(recovery_path.read_text()) if recovery_path.exists() else {}
        for index, entry in enumerate(entries):
            key = str(index)
            if progress.get(key, {}).get("phase") == "restored":
                continue
            source = Path(entry["source"])
            saved = backup / str(index)
            failed = source.with_name(source.name + f".failed-{backup.name}")
            item = progress.get(key)
            if item is None:
                if failed.exists():
                    raise ValueError(f"recovery target already exists: {failed}")
                staged = None
                if entry["exists"]:
                    descriptor, name = tempfile.mkstemp(prefix=f".{source.name}.restore-", dir=source.parent)
                    os.close(descriptor)
                    staged = Path(name)
                    if saved.is_dir():
                        staged.unlink()
                        shutil.copytree(saved, staged, symlinks=True)
                    else:
                        shutil.copy2(saved, staged)
                    packages.sync_tree(staged)
                item = {"phase": "prepared", "staged": str(staged) if staged else None}
                progress[key] = item
                write_json(recovery_path, progress)
            staged = Path(item["staged"]) if item["staged"] else None
            if staged is None or staged.exists():
                if source.exists():
                    if failed.exists():
                        raise ValueError(f"data changed during recovery; refusing to overwrite: {source}")
                    source.rename(failed)
                if staged:
                    staged.rename(source)
                packages.sync_directory(source.parent)
            elif not source.exists():
                raise ValueError(f"recovery lost both its staged and restored copy: {source}")
            item["phase"] = "restored"
            write_json(recovery_path, progress)
    transaction["phase"] = "ready-to-start"
    write_json(TRANSACTION, transaction)
    restart(transaction)
    transaction["phase"] = "recovered"
    write_json(TRANSACTION, transaction)
    print("charnel recovery complete; any failed data and backups were retained.", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("check", "status", "update", "recover", "launch", "socket", "rathole-launch"))
    args = parser.parse_args()
    if os.geteuid() == 0:
        parser.error("run as the app account, not root")
    try:
        installation = settings()
        if args.action == "rathole-launch":
            if installation.get("menu_player") == "rathole":
                prepare_socket(installation)
            return
        if args.action == "launch":
            prepare_launch(installation)
            return
        if args.action == "socket":
            prepare_socket(installation)
            return
        ROOT.mkdir(parents=True, exist_ok=True)
        with (ROOT / "update.lock").open("a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            if args.action in ("check", "status"):
                if TRANSACTION.exists() and json.loads(TRANSACTION.read_text())["phase"] not in SAFE_PHASES:
                    raise ValueError("unfinished update; run freqhole-pi recover charnel before checking again")
                with tempfile.TemporaryDirectory(prefix="charnel-check-", dir=ROOT) as directory:
                    release = packages.charnel_release(Path(directory))
                    packages.charnel_asset(release)
                installed = packages.installed_charnel()
                available = release["tag_name"][1:]
                newer = subprocess.run(["dpkg", "--compare-versions", available, "gt", installed]).returncode == 0
                if args.action == "status":
                    print(json.dumps({"installed": installed, "available": available, "update_available": newer}))
                else:
                    print(f"charnel: installed {installed}; available {available}; " +
                          ("update available: freqhole-pi update charnel" if newer else "no newer stable release"))
            elif args.action == "recover":
                recover(installation)
            else:
                update(installation)
    except (OSError, ValueError, KeyError, subprocess.SubprocessError) as error:
        detail = (error.stderr or str(error)) if isinstance(error, subprocess.CalledProcessError) else str(error)
        parser.exit(1, f"charnel {args.action} failed: {detail}\n")


if __name__ == "__main__":
    main()
