"""small, testable config edits used only by the interactive Pi installer."""

import argparse
import json
import os
import re
from pathlib import Path
import tempfile
import tomllib
import secrets


I2C_BLOCK = (
    "# freqhole-pi i2c begin\n[all]\n"
    "dtparam=i2c_arm=on,i2c_arm_baudrate=400000\n# freqhole-pi i2c end\n"
)

WIFI_WORDS = (
    "apple berry bird bloom boat bread brook cloud coral creek deer dove "
    "dream duck fern field flame fox frog frost grass grove gull hill "
    "honey horse lake leaf lemon light lily lime maple mint moon moss "
    "mouse ocean otter owl peach pear pine plum pond poppy rain reed "
    "river robin rock rose sand shell sky snow star stone sun tiger "
    "tree tulip wave wind"
).split()


def i2c_config(text):
    text = re.sub(
        r"(?m)^# freqhole-pi i2c begin\n.*?^# freqhole-pi i2c end\n?",
        "", text, flags=re.DOTALL,
    )
    lines = []
    for line in text.splitlines():
        if line.startswith("dtparam="):
            params, marker, comment = line[len("dtparam="):].partition("#")
            remaining = [
                part.strip() for part in params.split(",")
                if part.strip() and not part.strip().startswith("i2c_arm_baudrate=")
            ]
            line = ("dtparam=" + ",".join(remaining)) if remaining else ""
            if marker:
                line += " #" + comment
        lines.append(line)
    return "\n".join(lines).rstrip() + "\n\n" + I2C_BLOCK


def console_config(text):
    lines = [line for line in text.splitlines() if not re.match(r"^\s*FONT=", line)]
    return "\n".join(lines).rstrip() + '\nFONT="Uni2-VGA14.psf.gz"\n'


def shell_path_config(text):
    marker = "# freqhole-pi user commands"
    if marker in text.splitlines():
        return text
    block = (
        marker + '\ncase ":$PATH:" in\n'
        '    *":$HOME/.local/bin:"*) ;;\n'
        '    *) export PATH="$HOME/.local/bin:$PATH" ;;\n'
        'esac\n'
    )
    # put this before interactive-only guards in shell startup files.
    return block + "\n" + text


def socket_config(text, default_path=None):
    parsed = tomllib.loads(text)
    section = parsed.get("control_socket", {})
    if not isinstance(section, dict):
        raise ValueError("control_socket must be a TOML table")
    configured_path = section.get("socket_path")
    if configured_path is not None and (not isinstance(configured_path, str) or not configured_path):
        raise ValueError("control_socket.socket_path must be a nonempty string")
    # support the repository's conventional table format, not arbitrary TOML rewriting.
    match = re.search(r"(?m)^\[control_socket\][ \t]*(?:#.*)?$", text)
    if match:
        start = match.end()
        next_table = re.search(r"(?m)^\[", text[start:])
        end = start + next_table.start() if next_table else len(text)
        body = text[start:end]
        body, count = re.subn(r"(?m)^[ \t]*enabled[ \t]*=.*$", "enabled = true", body)
        if not count:
            body = "\nenabled = true\n" + body
        result = text[:start] + body + text[end:]
    elif "control_socket" not in parsed:
        result = text.rstrip() + "\n\n[control_socket]\nenabled = true\n"
    else:
        raise ValueError("use a [control_socket] table before enabling hardware setup")
    if default_path is not None and configured_path is None:
        result = re.sub(r"(?m)^(\[control_socket\][^\n]*)",
                        lambda match: match[0] + f"\nsocket_path = {json.dumps(str(default_path))}", result, count=1)
    if tomllib.loads(result)["control_socket"]["enabled"] is not True:
        raise ValueError("failed to enable the control socket")
    return result


def initial_player(text):
    parsed = tomllib.loads(text)
    if "initial_view" in parsed:
        updated, count = re.subn(r'(?m)^initial_view[ \t]*=.*$', 'initial_view = "player"', text)
        if count != 1:
            raise ValueError("initial_view is not a conventional top-level TOML key")
    else:
        updated = 'initial_view = "player"\n' + text
    if tomllib.loads(updated)["initial_view"] != "player":
        raise ValueError("failed to set the initial player view")
    return updated


def window_config(text, mode):
    states = json.loads(text)
    if not isinstance(states, dict):
        raise ValueError("window state must be a JSON object")
    defaults = {
        "width": 800, "height": 600, "x": 0, "y": 0, "prev_x": 0, "prev_y": 0,
        "maximized": False, "visible": True, "decorated": True, "fullscreen": False,
    }
    state = states.setdefault("main", {})
    if not isinstance(state, dict):
        raise ValueError("invalid main window state")
    for key, default in defaults.items():
        value = state.setdefault(key, default)
        if type(value) is not type(default):
            raise ValueError(f"invalid window state field: {key}")
    state.update(fullscreen=mode == "fullscreen", maximized=mode == "maximized", visible=True)
    return json.dumps(states, indent=2) + "\n"


def wifi_config(directory, interface):
    if not re.fullmatch(r"[a-zA-Z0-9_-]{1,15}", interface):
        raise ValueError("invalid Wi-Fi interface name")
    environment = directory / "wifi.env"
    if environment.exists():
        raise ValueError("Wi-Fi setup already exists; keep it or explicitly remove it before reconfiguration")
    info = {
        "ssid": "freqhole-setup-" + secrets.token_hex(2),
        "passphrase": f"{secrets.choice(WIFI_WORDS)}-{secrets.choice(WIFI_WORDS)}-{secrets.randbelow(10000):04}",
        "interface": interface,
        "gateway": "192.168.42.1",
    }
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    values = {
        "PORTAL_SSID": info["ssid"], "PORTAL_PASSPHRASE": info["passphrase"],
        "PORTAL_INTERFACE": interface, "PORTAL_GATEWAY": info["gateway"],
        "ACTIVITY_TIMEOUT": "600",
        "UI_DIRECTORY": "/usr/local/share/freqhole-pi/wifi-connect/v4.11.90/ui",
    }
    descriptor = os.open(environment, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w") as output:
        output.write("".join(f"{key}={value}\n" for key, value in values.items()))
    print(json.dumps(info))


def edit(path, transform):
    path = path.resolve()
    original = path.read_text()
    updated = transform(original)
    if original != updated:
        stat = path.stat()
        backup = path.with_name(path.name + ".before-freqhole-pi")
        if not backup.exists():
            descriptor = os.open(backup, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(descriptor, "w") as output:
                output.write(original)
            backup.chmod(stat.st_mode & 0o777)
        with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, delete=False) as output:
            temporary = Path(output.name)
            try:
                output.write(updated)
                output.flush()
                os.fsync(output.fileno())
                temporary.chmod(stat.st_mode & 0o777)
                if os.geteuid() == 0:
                    os.chown(temporary, stat.st_uid, stat.st_gid)
                temporary.replace(path)
            finally:
                temporary.unlink(missing_ok=True)


def update_menu_settings(path, updates):
    settings = json.loads(path.read_text()) if path.exists() else {}
    if not isinstance(settings, dict):
        raise ValueError("menu settings must be a JSON object")
    settings.update(updates)
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, delete=False) as output:
        temporary = Path(output.name)
        try:
            json.dump(settings, output, indent=2)
            output.flush()
            os.fsync(output.fileno())
            temporary.chmod(0o600)
            temporary.replace(path)
        finally:
            temporary.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("kind", choices=("i2c", "console", "socket", "player", "fullscreen", "maximized", "wifi", "path", "menu"))
    parser.add_argument("path", type=Path)
    parser.add_argument("--interface")
    parser.add_argument("--player", choices=("charnel", "rathole"))
    parser.add_argument("--socket-path")
    args = parser.parse_args()
    if args.kind == "menu":
        if not args.player or not args.socket_path:
            parser.error("menu requires --player and --socket-path")
        update_menu_settings(args.path, {"player": args.player, "socket_path": args.socket_path})
        return
    if args.kind == "wifi":
        if not args.interface:
            parser.error("wifi requires --interface")
        wifi_config(args.path, args.interface)
        return
    if args.kind in ("player", "fullscreen", "maximized", "path") and not args.path.exists():
        args.path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        args.path.write_text("{}" if args.kind != "player" else "")
        args.path.chmod(0o600)
    transforms = {"i2c": i2c_config, "console": console_config, "socket": socket_config,
                  "player": initial_player, "path": shell_path_config}
    if args.kind in ("fullscreen", "maximized"):
        edit(args.path, lambda text: window_config(text, args.kind))
    else:
        edit(args.path, transforms[args.kind])


if __name__ == "__main__":
    main()
