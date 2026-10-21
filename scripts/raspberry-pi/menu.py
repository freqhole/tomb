"""rotary-encoder menu for a 128x32 pioled and adafruit qt encoder (#4991).

run on the pi in the same environment as the working hardware tests:
    python3 menu.py

rathole runs in its own systemd service. setup.sh installs the optional menu
service and fixed-purpose service/power permissions.

both boards share board.I2C(): oled at 0x3C, encoder at 0x36.
turn to select, press to run. shutdown has a separate confirmation screen.
while playing, title and artist replace the menu heading and scroll with the
list. these are informational rows, not selectable actions.
after 30 seconds idle, a sleeping cat animates for 10 seconds; the neopixel
fades out during the final three seconds. both lights then turn off (the pi
stays awake). two net encoder clicks within 0.75 seconds, or a button press,
cancel the animation or wake the ui without activating or changing a selection.
the menu appears immediately; the neopixel fades in on startup and wake.
a sleeping shutdown confirmation is canceled. confirmed shutdown and normal
exit fade the led out before clearing and powering off the display.

each entry in COMMANDS is (menu label, action, rgb color), with channels 0-255.
a string action sends that line to rathole's unix socket; an argument tuple runs
a system command without a shell. None opens the volume screen: turn to adjust,
press to return. its bar uses get_state replies, not an estimated volume.
NETWORK_SCREEN opens local network status: turn to scroll, press to return.
other socket actions have no reply: "sent" means sent, not acknowledged.
input polling and sleep continue while commands run.
output/errors go to the terminal, or the journal when running as a service.
on ui startup, the system mixer is set to 100%; the volume screen still controls
only rathole's app volume. socket-only client invocations do not touch the mixer.

before requesting shutdown, the neopixel fades out and the oled is cleared and
powered off. shutdown and service control use sudo -n and need passwordless
permission for those commands (or root). failures appear on the ui and in logs.
a failed shutdown fades the led back in and displays the error. socket commands run as the menu user.
this script does not change sudo permissions or install services.
when the Pi updater is installed, update checks run in the background; installing
an update requires confirmation and temporarily stops playback.
"""


import argparse
from collections import deque
from concurrent.futures import ThreadPoolExecutor

import json
import math
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import sys
import time
import configure
from storage_menu import StorageMenu

# best effort only: missing mixer/tools, permission errors, and timeouts are nonfatal.
# set to None to leave the system mixer unchanged, or edit for your sound device.
SYSTEM_VOLUME_COMMAND = ("wpctl", "set-volume", "@DEFAULT_AUDIO_SINK@", "1.0")

SETTINGS_PATH = Path(__file__).resolve().with_name("menu.json")
SETTINGS = json.loads(SETTINGS_PATH.read_text()) if SETTINGS_PATH.exists() else {"player": "rathole"}
PLAYER = SETTINGS["player"]
if PLAYER not in ("rathole", "charnel"):
    raise ValueError("menu.json player must be rathole or charnel")
SOCKET_PATH = SETTINGS.get("socket_path", str(Path.home() / "rathole-control.sock"))
FONT_PATH = str(Path(__file__).resolve().with_name("font5x8.bin"))
PI_UPDATER = Path.home() / ".local/bin/freqhole-pi"
PI_MANAGED_PLAYER = PI_UPDATER.is_file() and (
    (Path.home() / ".local/share/freqhole-pi" / (
        "installed.json" if PLAYER == "rathole" else "installation.json"
    )).is_file()
)
UPDATE_ARGUMENTS = ("charnel",) if PLAYER == "charnel" else ()
PI_CONTROL = "/usr/local/libexec/freqhole-pi-control"
UPDATE_SCREEN = object()
RECOVERY_SCREEN = object()
REVERSE_WHEEL = object()
UPDATE_REFRESH_SECONDS = 24 * 60 * 60
SOCKET_TIMEOUT_SECONDS = 2.0
STATE_REFRESH_SECONDS = 0.5
VOLUME_STEP = 0.05
VOLUME_MAX = 2.0
VOLUME_MAX_STEPS = round(VOLUME_MAX / VOLUME_STEP)
NETWORK_REFRESH_SECONDS = 5.0
NETWORK_TIMEOUT_SECONDS = 4.0
NETWORK_SCREEN = object()
STORAGE_SCREEN = object()
WIFI_SCREEN = object()
WIFI_CONFIG = Path.home() / ".local/share/freqhole-pi/wifi.json"
WIFI_TOOL = Path.home() / ".local/bin/freqhole-wifi"
WIFI_INFO = json.loads(WIFI_CONFIG.read_text()) if WIFI_CONFIG.exists() else None

COMMANDS = (
    ("play / pause", "play_pause", (255, 0, 220)),
    ("next track", "next", (255, 25, 145)),
    ("previous track", "previous", (210, 0, 175)),
    ("volume", None, (255, 60, 210)),
    ("stop playback", "stop", (165, 0, 100)),
    (f"show {PLAYER} player", "show_player", (255, 90, 180)),
    # both rotate the session pin; admin also grants the next pairing admin access.
    ("rotate pairing pin", "rotate_pin", (0, 255, 210)),
    ("new admin pairing", "show_admin_pin", (50, 200, 165)),
    ("network status", NETWORK_SCREEN, (40, 255, 100)),
    ("library disks", STORAGE_SCREEN, (80, 160, 255)),
    ("reverse wheel", REVERSE_WHEEL, (80, 160, 255)),
)
if PLAYER == "charnel":
    COMMANDS += (
        ("start charnel", ("systemctl", "--user", "start", "charnel.service"), (80, 180, 80)),
        ("stop charnel", ("systemctl", "--user", "stop", "charnel.service"), (190, 60, 0)),
        ("restart charnel", ("systemctl", "--user", "restart", "charnel.service"), (150, 0, 0)),
    )
else:
    COMMANDS += (
        ("start rathole", ("sudo", "-n", PI_CONTROL, "start"), (80, 180, 80)),
        ("stop rathole", ("sudo", "-n", PI_CONTROL, "stop"), (190, 60, 0)),
        ("restart rathole", ("sudo", "-n", PI_CONTROL, "restart"), (150, 0, 0)),
    )
if PI_MANAGED_PLAYER:
    COMMANDS += (
        ("check update", UPDATE_SCREEN, (255, 160, 0)),
    )
    if PLAYER == "charnel":
        COMMANDS += (("recover failed update", RECOVERY_SCREEN, (255, 80, 0)),)
if WIFI_INFO is not None and WIFI_TOOL.is_file():
    COMMANDS += (
        ("set up wifi", WIFI_SCREEN, (40, 255, 100)),
        ("stop wifi setup", ("sudo", "-n", PI_CONTROL, "wifi-stop"), (150, 80, 0)),
    )
SHUTDOWN_COMMAND = ("sudo", "-n", PI_CONTROL, "poweroff")
SHUTDOWN_COLOR = (255, 0, 0)
CANCEL_COLOR = (0, 230, 255)
IDLE_SECONDS = 30.0
SLEEP_ANIMATION_SECONDS = 10.0
SLEEP_FADE_SECONDS = 3.0  # a long fade makes the low 8-bit brightness steps linger.
SLEEP_FPS = 10
SLEEP_ANIMATE_DURING_FADE = False  # avoid blocking led updates with full oled transfers.
WAKE_ENCODER_CLICKS = 2
WAKE_ENCODER_WINDOW_SECONDS = 0.75  # isolated stray clicks must not accumulate forever.
WAKE_FADE_SECONDS = 3.0
POWER_OFF_FADE_SECONDS = 3.0  # shutdown and normal service exit wait for this fade.
WAKE_FPS = 60
FADE_GAMMA = 2.2  # approximate perceptual brightness; 1.0 gives a linear light ramp.
POLL_SECONDS = 0.01
DEBOUNCE_SECONDS = 0.03
DIRECTION = SETTINGS.get("direction", 1)
if type(DIRECTION) is not int or DIRECTION not in (-1, 1):
    raise ValueError("menu direction must be 1 or -1")
ENCODER_MAX_STEPS_PER_SECOND = 200  # reject implausible counter jumps, not normal turns.
ENCODER_SETTLE_READS = 3
ENCODER_DEBUG = False  # enable raw movement, ignored jumps, and baseline diagnostics.
BRIGHTNESS = 0.2

# drawn at 2x size: closed eyes, pointy ears, and a curled tail.
SLEEPING_CAT = (
    "   #   #                    ",
    "  # # # #                   ",
    "  #  #  #     #######       ",
    "  #     ######       ##     ",
    " #                     #    ",
    " #  ##  ##              #   ",
    " #     #          ###   #   ",
    "  #   ###        #   #  #   ",
    "   ###   #        ####  #   ",
    "     #   #             #    ",
    "    ###################     ",
)


class EncoderMotion:
    """validate raw counter changes before applying the configured direction."""

    def __init__(self):
        self.position = None
        self.last_read = None
        self.candidate = None
        self.settle_reads = 0
        self.next_warning = 0

    @staticmethod
    def difference(position, previous):
        # seesaw returns a signed 32-bit counter; crossing its boundary is one step.
        return (position - previous + 2**31) % 2**32 - 2**31

    def update(self, position, now):
        elapsed = 0 if self.last_read is None else max(0, now - self.last_read)
        self.last_read = now
        # allow a small burst, but don't trust a huge jump after a long ui pause.
        limit = 4 + int(ENCODER_MAX_STEPS_PER_SECOND * min(elapsed, 0.25))
        if self.position is not None:
            delta = self.difference(position, self.position)
            if abs(delta) <= limit:
                self.position = position
                self.candidate = None
                self.settle_reads = 0
                if delta and ENCODER_DEBUG:
                    print(f"encoder: raw={position}, delta={delta}, movement={DIRECTION * delta}", flush=True)
                return DIRECTION * delta
            if ENCODER_DEBUG and now >= self.next_warning:
                print(
                    f"encoder jump ignored: previous={self.position}, raw={position}, "
                    f"delta={delta}, limit={limit}; check competing scripts, wiring, and i2c speed",
                    file=sys.stderr, flush=True,
                )
                self.next_warning = now + 1

        # keep the last good position across a single spike. a persistent new counter
        # (for example after a board reset) must settle before becoming the baseline.
        if self.candidate is not None and abs(self.difference(position, self.candidate)) <= limit:
            self.settle_reads += 1
        else:
            self.settle_reads = 1
        self.candidate = position
        if self.settle_reads >= ENCODER_SETTLE_READS:
            if ENCODER_DEBUG:
                print(f"encoder baseline: {position}", flush=True)
            self.position = position
            self.candidate = None
            self.settle_reads = 0
        return 0


def current_socket_path():
    # the wizard may create a config after the hardware menu has already started.
    if SETTINGS_PATH.exists():
        path = json.loads(SETTINGS_PATH.read_text()).get("socket_path", SOCKET_PATH)
        if not isinstance(path, str) or not path.startswith("/"):
            raise ValueError("menu socket_path must be an absolute path")
        return path
    return SOCKET_PATH


def send_socket_command(command):
    if command == "get_state":
        try:
            print(json.dumps(read_state()))
        except (OSError, ValueError) as error:
            print(f"state request failed: {error}", file=sys.stderr, flush=True)
            return 1
        return 0
    path = current_socket_path()
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
            connection.settimeout(SOCKET_TIMEOUT_SECONDS)
            connection.connect(path)
            connection.sendall((command + "\n").encode("ascii"))
            # the protocol has no reply; close without waiting or retrying a toggle.
    except OSError as error:
        print(f"could not send {command} to {path}: {error}", file=sys.stderr, flush=True)
        return 1
    print(f"sent {command} to {path} (no reply expected)", flush=True)
    return 0


def read_state(steps=0):
    """send optional volume changes, then read one playback state reply."""
    command = "volume_up" if steps > 0 else "volume_down"
    payload = (command + "\n") * abs(steps) + "get_state\n"
    deadline = time.monotonic() + SOCKET_TIMEOUT_SECONDS
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
        connection.settimeout(SOCKET_TIMEOUT_SECONDS)
        connection.connect(current_socket_path())
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("state request timed out")
        connection.settimeout(remaining)
        connection.sendall(payload.encode("ascii"))
        reply = bytearray()
        # bound both the total request time and the reply size, including partial reads.
        while b"\n" not in reply:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError("state reply timed out")
            connection.settimeout(remaining)
            chunk = connection.recv(4096)
            if not chunk:
                raise ValueError("socket closed without a complete state reply")
            reply.extend(chunk)
            if len(reply) > 65536:
                raise ValueError("state reply too large")
    state = json.loads(reply.split(b"\n", 1)[0])
    volume = state.get("volume") if isinstance(state, dict) else None
    if type(volume) not in (int, float) or not 0 <= volume <= VOLUME_MAX:
        raise ValueError("state reply has no valid volume between 0 and 2")
    return state


def now_playing_lines(state):
    if state.get("kind") not in ("song", "video") or state.get("is_playing") is not True:
        return ()
    lines = []
    for field, fallback in (("title", "untitled"), ("artist", "playing " + state["kind"])):
        text = state.get(field)
        if not isinstance(text, str) or not text.strip():
            text = fallback
        # keep metadata on one row and within the built-in font's character set.
        lines.append(" ".join(text.split()).lower().encode("ascii", "replace").decode("ascii"))
    return tuple(lines)


def read_network():
    """read local link/address information without probing the internet."""
    deadline = time.monotonic() + NETWORK_TIMEOUT_SECONDS
    result = subprocess.run(
        ("ip", "-j", "address", "show"),
        check=True, capture_output=True, text=True, timeout=NETWORK_TIMEOUT_SECONDS,
    )
    interfaces = json.loads(result.stdout)
    if not isinstance(interfaces, list):
        raise ValueError("ip returned an invalid interface list")
    rows = [f"host: {socket.gethostname()}"]
    iw = shutil.which("iw")
    for interface in interfaces:
        name = interface["ifname"]
        if "LOOPBACK" in interface.get("flags", []) or name == "lo":
            continue
        device = Path("/sys/class/net") / name
        wireless = (device / "wireless").exists() or (device / "phy80211").exists()
        state = interface.get("operstate", "unknown").lower()
        rows.append(f"{'wifi ' if wireless else ''}{name}: {state}")
        remaining = deadline - time.monotonic()
        if wireless and iw and remaining > 0:
            try:
                link = subprocess.run(
                    (iw, "dev", name, "link"),
                    check=True, capture_output=True, text=True, timeout=remaining,
                )
                for line in link.stdout.splitlines():
                    line = line.strip()
                    if line.startswith("SSID:"):
                        rows.append("ssid: " + line.split(":", 1)[1].strip())
                    elif line.startswith("signal:"):
                        rows.append(line)
                    elif line == "Not connected.":
                        rows.append("not associated")
            except (OSError, subprocess.SubprocessError):
                rows.append("wifi details unknown")
        elif wireless:
            rows.append("wifi details unknown")
        addresses = [
            address for address in interface.get("addr_info", [])
            if address.get("family") in ("inet", "inet6") and address.get("scope") == "global"
        ]
        rows.extend(
            f"{'ip4' if address['family'] == 'inet' else 'ip6'}: {address['local']}"
            for address in addresses
        )
        if not addresses:
            rows.append("no global ip address")
    if len(rows) == 1:
        rows.append("no network interfaces")
    return rows


class Button:
    """report a press/release only after the input has settled."""

    def __init__(self, pressed, now):
        self.pressed = pressed
        self.candidate = pressed
        self.changed_at = now

    def update(self, raw_pressed, now):
        if raw_pressed != self.candidate:
            self.candidate = raw_pressed
            self.changed_at = now
        if self.candidate != self.pressed and now - self.changed_at >= DEBOUNCE_SECONDS:
            self.pressed = self.candidate
            return self.pressed
        return None


def read_update_status():
    result = subprocess.run(
        (str(PI_UPDATER), "status", *UPDATE_ARGUMENTS), capture_output=True, text=True, check=True, timeout=45,
    )
    status = json.loads(result.stdout)
    if (
        not isinstance(status, dict)
        or type(status.get("update_available")) is not bool
        or not isinstance(status.get("available"), str)
        or not isinstance(status.get("installed"), str)
    ):
        raise ValueError("invalid update status")
    return status


def read_wifi_status():
    result = subprocess.run(
        (str(WIFI_TOOL), "status"), capture_output=True, text=True, check=True, timeout=10,
    )
    status = json.loads(result.stdout)
    if not isinstance(status, dict) or not all(isinstance(status.get(key), str) for key in ("state", "result")):
        raise ValueError("invalid wifi service status")
    return status


class Menu:
    def __init__(self, oled, pixel, now, button_pressed=False):
        self.oled = oled
        self.pixel = pixel
        self.button = Button(button_pressed, now)
        self.last_activity = now
        self.selected = 0
        self.confirm_selected = 0
        self.confirm_update = False
        self.confirm_recovery = False
        self.screen = "menu"
        self.message = ()
        self.asleep = False
        self.sleep_started = None
        self.last_sleep_frame = -1
        self.pixel_color = (0, 0, 0)
        self.pixel_output = (0, 0, 0)
        self.pixel_levels = None
        self.wake_started = None
        self.wake_encoder_delta = 0
        self.wake_encoder_started = None
        self.wake_from = (0, 0, 0)
        self.last_wake_frame = -1
        self.ignore_press = button_pressed
        self.process = None
        self.running_label = ""
        self.running_shutdown = False
        self.running_socket = False
        self.shutdown_requested = False
        self.volume = None
        self.volume_error = False
        self.volume_pending = deque()
        self.now_playing = ()
        self.state_future = None
        self.state_next_refresh = 0
        self.state_worker = ThreadPoolExecutor(max_workers=1)
        self.network_worker = ThreadPoolExecutor(max_workers=1)
        self.network_future = None
        self.network_next_refresh = 0
        self.network_rows = ("reading...",)
        self.network_offset = 0
        self.network_error = False
        self.update_worker = ThreadPoolExecutor(max_workers=1)
        self.update_future = None
        self.update_next_refresh = 0
        self.update_status = None
        self.update_error = False
        self.update_requested = False
        self.wifi_future = None
        self.wifi_next_refresh = 0
        self.storage = StorageMenu(current_socket_path)
        self.dirty = True
        # apply brightness in write_pixel so each channel is rounded only once.
        self.pixel.brightness = 1.0
        self.write_pixel((0, 0, 0))
        self.wake_lights(now)
        self.render()

    def render(self):
        if self.asleep or self.sleep_started is not None or self.shutdown_requested or not self.dirty:
            return
        if self.screen == "running" and self.running_shutdown:
            return
        if self.screen == "menu":
            labels = [
                ("checking update..." if self.update_requested else
                 "install update" if self.update_status and self.update_status["update_available"] else
                 "check update !" if self.update_error else "check update")
                if command is UPDATE_SCREEN else label
                for label, command, _ in COMMANDS
            ] + ["shut down pi"]
            items = [
                ("> " if index == self.selected else "  ") + label
                for index, label in enumerate(labels)
            ]
            if self.now_playing:
                # include metadata in the viewport, but keep selection indexed by action.
                rows = [*self.now_playing, *items]
                start = max(0, len(self.now_playing) + self.selected - 3)
                lines = rows[start:start + 4]
            else:
                start = max(0, self.selected - 2)
                lines = [f"{PLAYER} {self.selected + 1}/{len(labels)}", *items[start:start + 3]]
            color = SHUTDOWN_COLOR if self.selected == len(COMMANDS) else COMMANDS[self.selected][2]
        elif self.screen == "storage":
            lines = self.storage.lines()
            color = (255, 0, 0) if self.storage.error else (80, 160, 255)
        elif self.screen == "volume":
            title = "volume --" if self.volume is None else f"volume {self.volume:.0%}"
            detail = "unavailable: see logs" if self.volume_error else "reading..."
            if self.volume is not None:
                detail = "0%      100%     200%"
            lines = [title, detail, "", "turn +/-  press: back"]
            color = (255, 0, 0) if self.volume_error else COMMANDS[self.selected][2]
        elif self.screen in ("network", "wifi"):
            visible = self.network_rows[self.network_offset:self.network_offset + 2]
            lines = [
                f'{self.screen} {self.network_offset + 1}/{len(self.network_rows)}',
                visible[0], visible[1] if len(visible) > 1 else "",
                "turn:scroll push:back",
            ]
            color = (255, 0, 0) if self.network_error else COMMANDS[self.selected][2]
        elif self.screen == "confirm":
            title = ("restore pre-update?" if self.confirm_recovery else
                     "update? stops playback" if self.confirm_update else "u sure? shut down pi?")
            lines = [title]
            if self.confirm_update and self.update_status:
                lines.append(f'{self.update_status["installed"]} -> {self.update_status["available"]}')
            lines += [
                ("> " if index == self.confirm_selected else "  ") + label
                for index, label in enumerate((
                    "restore" if self.confirm_recovery else "update" if self.confirm_update else "shut down", "cancel",
                ))
            ]
            color = SHUTDOWN_COLOR if self.confirm_selected == 0 else CANCEL_COLOR
        elif self.screen == "wifi-confirm":
            lines = ["wifi may drop SSH", "portal: max 10 min"] + [
                ("> " if index == self.confirm_selected else "  ") + label
                for index, label in enumerate(("start wifi setup", "cancel"))
            ]
            color = (255, 160, 0)
        elif self.screen == "running":
            lines = ["sending..." if self.running_socket else "running...", self.running_label, "see logs"]
            color = (255, 100, 0)
        elif self.screen == "update-check":
            lines = ["checking update...", PLAYER, "please wait"]
            color = (255, 160, 0)
        else:
            lines = [*self.message, "turn/press: back"]
            color = (0, 255, 0) if self.screen == "success" else (255, 0, 0)

        self.oled.fill(0)
        # the built-in 5x8 font uses 6 pixels per character including spacing.
        columns = self.oled.width // 6
        for row, line in enumerate(lines[:4]):
            self.oled.text(line[:columns], 0, row * 8, 1, font_name=FONT_PATH)
        if self.screen == "volume" and self.volume is not None:
            self.oled.rect(0, 17, self.oled.width, 6, 1)
            filled = round((self.oled.width - 2) * self.volume / VOLUME_MAX)
            if filled:
                self.oled.fill_rect(1, 18, filled, 4, 1)
            self.oled.vline(self.oled.width // 2, 16, 8, 1)
        self.oled.show()
        self.pixel_color = color
        if self.wake_started is None:
            self.write_pixel(color)
        self.dirty = False

    def write_pixel(self, color):
        brightness = max(0.0, min(1.0, BRIGHTNESS))
        levels = tuple(round(channel * brightness) for channel in color)
        if levels != self.pixel_levels:
            self.pixel.fill(levels)
            self.pixel_levels = levels
        # retain the actual output, in unscaled units, for interrupted fades.
        self.pixel_output = tuple(level / brightness for level in levels) if brightness else (0, 0, 0)

    def fade_pixel(self, start, target, progress):
        # interpolate perceived brightness; keep fractions until the final hardware write.
        self.write_pixel(tuple(
            (a ** (1 / FADE_GAMMA) * (1 - progress)
             + b ** (1 / FADE_GAMMA) * progress) ** FADE_GAMMA
            for a, b in zip(start, target)
        ))

    def wake_lights(self, now):
        self.wake_encoder_delta = 0
        self.wake_encoder_started = None
        self.asleep = False
        self.sleep_started = None
        self.wake_started = now
        self.wake_from = self.pixel_output
        self.last_wake_frame = -1
        self.last_activity = now
        self.dirty = True
        self.oled.poweron()

    def render_wake(self, now):
        if self.wake_started is None:
            return
        elapsed = max(0, now - self.wake_started)
        if elapsed >= WAKE_FADE_SECONDS:
            self.wake_started = None
            self.write_pixel(self.pixel_color)
            return
        frame = int(elapsed * WAKE_FPS)
        if frame == self.last_wake_frame:
            return
        self.last_wake_frame = frame
        progress = elapsed / WAKE_FADE_SECONDS
        self.fade_pixel(self.wake_from, self.pixel_color, progress)

    def render_sleep(self, now):
        elapsed = now - self.sleep_started
        if elapsed >= SLEEP_ANIMATION_SECONDS:
            self.sleep_started = None
            self.asleep = True
            self.lights_off()
            return

        # use the wake curve in reverse, without stretching it over the whole cat animation.
        # still update every poll; extra frames cannot add more 8-bit brightness levels.
        duration = min(SLEEP_FADE_SECONDS, SLEEP_ANIMATION_SECONDS)
        remaining = SLEEP_ANIMATION_SECONDS - elapsed
        progress = max(0.0, 1 - remaining / duration) if duration > 0 else 0.0
        self.fade_pixel(self.pixel_color, (0, 0, 0), progress)
        # hold the last cat frame during the fade; input polling still runs normally.
        if progress > 0 and not SLEEP_ANIMATE_DURING_FADE and self.last_sleep_frame >= 0:
            return
        frame = int(elapsed * SLEEP_FPS)
        if frame == self.last_sleep_frame:
            return
        self.last_sleep_frame = frame
        self.oled.fill(0)
        update_available = bool(self.update_status and self.update_status["update_available"])
        bob = 1 if math.sin(elapsed * math.tau / 3) > 0 else 0
        for y, row in enumerate(SLEEPING_CAT):
            for x, cell in enumerate(row):
                if cell == "#":
                    self.oled.fill_rect(64 + x * 2, (8 if update_available else 7) + bob + y * 2, 2, 2, 1)
        for index, letter in enumerate("" if update_available else "zzz"):
            phase = (elapsed / 3 - index / 3) % 1
            x = 40 - int(26 * phase + 3 * math.sin(elapsed * 2 + index))
            y = 22 - int(22 * phase)
            self.oled.text(letter, x, y, 1, font_name=FONT_PATH)
        if update_available:
            self.oled.text("UPDATE AVAILABLE!", 13, 0, 1, font_name=FONT_PATH)
        self.oled.show()


    def start_command(self, label, command, shutdown=False):
        self.running_label = label
        self.running_shutdown = shutdown
        self.running_socket = isinstance(command, str)
        self.screen = "running"
        self.dirty = True
        self.render()
        if shutdown:
            self.oled.fill(0)
            self.oled.text("shutting down...", 0, 0, 1, font_name=FONT_PATH)
            self.oled.show()
            # finish the fade before the command can cause systemd to stop this process.
            self.lights_off(fade=True)
        print(f"running {label}: {command}", flush=True)
        if self.running_socket:
            # reuse this script as a short-lived client so socket waits don't block the ui.
            command = (sys.executable, str(Path(__file__).resolve()), "--send", command)
        try:
            # inherit stdout/stderr rather than filling an unread output pipe.
            self.process = subprocess.Popen(command, stdin=subprocess.DEVNULL)
        except OSError as error:
            print(f"could not start {label}: {error}", flush=True)
            self.screen = "error"
            self.message = ("could not start", label, "see logs")
            if shutdown:
                self.wake_lights(time.monotonic())
            self.dirty = True

    def poll_command(self):
        if self.process is None:
            return
        result = self.process.poll()
        if result is None:
            return
        self.process = None
        if self.running_label == "set up wifi" and result == 0:
            self.screen = "wifi"
            self.network_rows = (
                "starting wifi setup", WIFI_INFO["ssid"], f'pw: {WIFI_INFO["passphrase"]}',
                f'http://{WIFI_INFO["gateway"]}', "max 10 min; stop via menu",
            )
            self.network_offset = 1
            self.network_error = False
            self.wifi_next_refresh = 0
            self.dirty = True
            return
        if self.running_label in ("install update", "recover failed update"):
            self.update_next_refresh = 0
        print(f"{self.running_label}: exit {result}", flush=True)
        if self.running_shutdown and result == 0:
            self.shutdown_requested = True
            self.lights_off()
            print("shutdown requested.", flush=True)
            return
        self.screen = "success" if result == 0 else "error"
        title = "done" if result == 0 else "command failed"
        if self.running_shutdown:
            title = "onoz! shutdown failed"
            self.wake_lights(time.monotonic())
        if self.running_socket:
            title = "sent" if result == 0 else "send failed"
            detail = "no reply expected" if result == 0 else "see logs"
            self.message = (title, self.running_label, detail)
        else:
            self.message = (title, f"exit code: {result}", "see logs")
        self.dirty = True

    def queue_volume(self, delta):
        # keep reversals in order: down then up at zero must still turn the volume up.
        steps = max(-VOLUME_MAX_STEPS, min(VOLUME_MAX_STEPS, delta))
        if self.volume_pending and (self.volume_pending[-1] > 0) == (steps > 0):
            steps += self.volume_pending.pop()
            steps = max(-VOLUME_MAX_STEPS, min(VOLUME_MAX_STEPS, steps))
        self.volume_pending.append(steps)

    def poll_state(self, now):
        if self.state_future is not None and self.state_future.done():
            previous_lines = self.now_playing
            try:
                state = self.state_future.result()
                self.volume = state["volume"]
                self.now_playing = now_playing_lines(state)
                self.volume_error = False
            except (OSError, ValueError) as error:
                if not self.volume_error:
                    print(f"state request failed: {error}", file=sys.stderr, flush=True)
                self.volume = None
                self.now_playing = ()
                self.volume_error = True
                # a partial write may have changed volume; never replay a failed batch.
                self.volume_pending.clear()
            self.state_future = None
            self.state_next_refresh = now + STATE_REFRESH_SECONDS
            if self.screen == "volume" or (self.screen == "menu" and self.now_playing != previous_lines):
                self.dirty = True

        if self.screen not in ("menu", "volume") or self.asleep or self.sleep_started is not None:
            return
        if self.state_future is None and (self.volume_pending or now >= self.state_next_refresh):
            steps = self.volume_pending.popleft() if self.volume_pending else 0
            # share one background query for the menu metadata and volume display.
            self.state_future = self.state_worker.submit(read_state, steps)

    def poll_network(self, now):
        if self.network_future is not None and self.network_future.done():
            try:
                rows = self.network_future.result()
                self.network_error = False
            except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as error:
                if not self.network_error:
                    print(f"network status failed: {error}", file=sys.stderr, flush=True)
                rows = ["unavailable", "see logs"]
                self.network_error = True
            if self.screen != "network":
                self.network_future = None
                return
            # wrap long ssids and ipv6 addresses instead of losing their ends.
            columns = self.oled.width // 6
            wrapped = []
            for row in rows:
                text = " ".join(row.split()).encode("ascii", "replace").decode("ascii")
                wrapped.extend(text[index:index + columns] for index in range(0, len(text), columns))
            self.network_rows = tuple(wrapped) or ("no network details",)
            self.network_offset = min(self.network_offset, max(0, len(self.network_rows) - 2))
            self.network_future = None
            self.network_next_refresh = now + NETWORK_REFRESH_SECONDS
            if self.screen == "network":
                self.dirty = True

        if self.screen != "network" or self.asleep or self.sleep_started is not None:
            return
        if self.network_future is None and now >= self.network_next_refresh:
            self.network_future = self.network_worker.submit(read_network)

    def poll_wifi(self, now):
        if self.wifi_future is not None and self.wifi_future.done():
            try:
                status = self.wifi_future.result()
                label = f'wifi {status["state"]}'
                if status["result"] != "success":
                    label = f'wifi: {status["result"]}'
                self.network_error = status["state"] == "failed"
            except (OSError, ValueError, subprocess.SubprocessError) as error:
                # command errors have only service status, not provisioning credentials.
                print(f"wifi status failed: {error}", file=sys.stderr, flush=True)
                label = "wifi status error"
                self.network_error = True
            self.wifi_future = None
            if self.screen == "wifi":
                self.network_rows = (label, *self.network_rows[1:])
                self.dirty = True
            self.wifi_next_refresh = now + 2
        if (
            self.screen == "wifi" and not self.asleep and self.sleep_started is None
            and self.wifi_future is None and now >= self.wifi_next_refresh
        ):
            self.wifi_future = self.network_worker.submit(read_wifi_status)

    def poll_updates(self, now):
        if self.update_future is not None and self.update_future.done():
            try:
                self.update_status = self.update_future.result()
                self.update_error = False
                self.update_next_refresh = now + UPDATE_REFRESH_SECONDS
            except (OSError, ValueError, subprocess.SubprocessError) as error:
                detail = error.stderr if isinstance(error, subprocess.CalledProcessError) else str(error)
                print(f"update check failed: {detail}", file=sys.stderr, flush=True)
                self.update_status = None
                self.update_error = True
                self.update_next_refresh = now + 300
            self.update_future = None
            self.dirty = True
            if self.update_requested:
                self.update_requested = False
                if self.update_error:
                    self.screen = "error"
                    self.message = ("update check failed", "see logs")
                elif self.update_status["update_available"]:
                    self.screen = "confirm"
                    self.confirm_selected = 1
                    self.confirm_update = True
                    self.confirm_recovery = False
                else:
                    self.screen = "success"
                    self.message = ("already up to date", PLAYER, self.update_status["installed"])
        if (
            PI_MANAGED_PLAYER and self.update_future is None and self.process is None
            and now >= self.update_next_refresh
        ):
            self.update_future = self.update_worker.submit(read_update_status)

    def activate(self):
        global DIRECTION
        if self.screen == "menu":
            if self.selected == len(COMMANDS):
                self.screen = "confirm"
                self.confirm_selected = 0
                self.confirm_update = False
                self.confirm_recovery = False
            else:
                label, command, _ = COMMANDS[self.selected]
                if command is REVERSE_WHEEL:
                    direction = -DIRECTION
                    try:
                        configure.update_menu_settings(SETTINGS_PATH, {"direction": direction})
                    except (OSError, ValueError) as error:
                        print(f"could not save wheel direction: {error}", file=sys.stderr, flush=True)
                        self.screen = "error"
                        self.message = ("could not save", "wheel direction", "see logs")
                    else:
                        DIRECTION = direction
                        self.screen = "success"
                        self.message = ("wheel reversed", "saved")
                elif command is None:
                    self.screen = "volume"
                    self.volume = None
                    self.volume_error = False
                    self.state_next_refresh = 0
                elif command is NETWORK_SCREEN:
                    self.running_label = ""
                    self.screen = "network"
                    self.network_rows = ("reading...",)
                    self.network_offset = 0
                    self.network_error = False
                    self.network_next_refresh = 0
                elif command is STORAGE_SCREEN:
                    self.storage.open()
                    self.screen = "storage"
                elif command is WIFI_SCREEN:
                    self.screen = "wifi-confirm"
                    self.confirm_selected = 1
                elif command is UPDATE_SCREEN:
                    self.update_requested = True
                    self.update_next_refresh = 0
                    self.screen = "update-check"
                elif command is RECOVERY_SCREEN:
                    self.screen = "confirm"
                    self.confirm_selected = 1
                    self.confirm_update = False
                    self.confirm_recovery = True
                else:
                    self.start_command(label, command)
        elif self.screen == "storage":
            self.storage.press()
            if not self.storage.active:
                self.screen = "menu"
        elif self.screen in ("network", "wifi"):
            self.screen = "menu"
        elif self.screen == "wifi-confirm":
            if self.confirm_selected == 0:
                self.start_command("set up wifi", ("sudo", "-n", PI_CONTROL, "wifi-start"))
            else:
                self.screen = "menu"
        elif self.screen == "volume":
            self.volume_pending.clear()
            self.screen = "menu"
        elif self.screen == "confirm":
            if self.confirm_selected == 0:
                if self.confirm_recovery:
                    self.start_command("recover failed update", (str(PI_UPDATER), "recover", "charnel"))
                elif self.confirm_update:
                    self.start_command("install update", (str(PI_UPDATER), "update", *UPDATE_ARGUMENTS))
                else:
                    self.start_command("shut down pi", SHUTDOWN_COMMAND, shutdown=True)
            else:
                self.screen = "menu"
        elif self.screen in ("success", "error"):
            self.screen = "menu"
        self.dirty = True

    def tick(self, now, delta, raw_pressed):
        edge = self.button.update(raw_pressed, now)
        self.poll_command()
        self.poll_state(now)
        self.poll_network(now)
        self.poll_wifi(now)
        self.poll_updates(now)
        if not self.shutdown_requested and not self.running_shutdown:
            wake = self.storage.tick(now, self.screen == "menu")
            if wake:
                self.wake_lights(now)
                self.last_activity = now
                self.ignore_press = raw_pressed or self.button.pressed
                self.screen = "storage"
            if self.screen == "storage":
                if not self.storage.active:
                    self.screen = "menu"
                if self.storage.dirty:
                    self.dirty = True
                    self.storage.dirty = False
        if self.shutdown_requested or (self.running_shutdown and self.process is not None):
            return

        if self.asleep or self.sleep_started is not None:
            if self.wake_encoder_started is not None and now - self.wake_encoder_started > WAKE_ENCODER_WINDOW_SECONDS:
                self.wake_encoder_delta = 0
                self.wake_encoder_started = None
            if delta:
                if self.wake_encoder_started is None:
                    self.wake_encoder_started = now
                # count net movement so a +1/-1 wobble does not count as two clicks.
                self.wake_encoder_delta += delta
            encoder_wake = abs(self.wake_encoder_delta) >= max(1, WAKE_ENCODER_CLICKS)
            if encoder_wake or raw_pressed or edge is True:
                self.wake_lights(now)
                # consume the whole wake press, even if it is still debouncing.
                self.ignore_press = raw_pressed or self.button.pressed
                self.state_next_refresh = 0
                self.now_playing = ()
                if self.screen == "volume":
                    self.volume = None
                    self.volume_error = False
                elif self.screen == "network":
                    self.network_rows = ("reading...",)
                    self.network_offset = 0
                    self.network_error = False
                    self.network_next_refresh = 0
                self.dirty = True
                self.render()
                self.render_wake(now)
            elif self.sleep_started is not None:
                self.render_sleep(now)
            return

        if delta or edge is not None or raw_pressed or self.button.pressed:
            self.last_activity = now

        if self.ignore_press:
            if not raw_pressed and not self.button.pressed:
                self.ignore_press = False
            edge = None

        if self.screen in ("volume", "network", "wifi") and edge is True:
            self.activate()
        elif delta:
            if self.screen == "storage":
                self.storage.turn(delta)
            elif self.screen == "volume":
                self.queue_volume(delta)
            elif self.screen in ("network", "wifi"):
                self.network_offset = max(0, min(max(0, len(self.network_rows) - 2), self.network_offset + delta))
            elif self.screen == "menu":
                self.selected = max(0, min(len(COMMANDS), self.selected + delta))
            elif self.screen in ("confirm", "wifi-confirm"):
                self.confirm_selected = max(0, min(1, self.confirm_selected + delta))
            elif self.screen in ("success", "error"):
                self.screen = "menu"
            self.dirty = True
        elif edge is True:
            self.activate()

        if self.screen == "storage" and self.storage.mode != "known":
            self.last_activity = now
        if now - self.last_activity >= IDLE_SECONDS:
            self.volume_pending.clear()
            self.wake_started = None
            self.wake_encoder_delta = 0
            self.wake_encoder_started = None
            self.sleep_started = now
            self.last_sleep_frame = -1
            if self.screen in ("confirm", "wifi-confirm"):
                self.screen = "menu"
                self.confirm_selected = 0
            self.render_sleep(now)
        else:
            self.render()
            self.render_wake(now)

    def lights_off(self, fade=False):
        self.wake_started = None
        try:
            if fade and any(self.pixel_output) and POWER_OFF_FADE_SECONDS > 0:
                start = self.pixel_output
                started = time.monotonic()
                # only shutdown/exit waits here; sleep fades remain interruptible in tick.
                while True:
                    elapsed = time.monotonic() - started
                    if elapsed >= POWER_OFF_FADE_SECONDS:
                        break
                    self.fade_pixel(start, (0, 0, 0), elapsed / POWER_OFF_FADE_SECONDS)
                    time.sleep(POLL_SECONDS)
        finally:
            # errors or a second ctrl-c must still attempt to leave both lights off.
            try:
                self.write_pixel((0, 0, 0))
            finally:
                try:
                    self.oled.fill(0)
                    self.oled.show()
                finally:
                    self.oled.poweroff()

    def close(self):
        try:
            if self.process is not None and self.process.poll() is None:
                self.process.terminate()
                try:
                    self.process.wait(timeout=1)
                except subprocess.TimeoutExpired:
                    self.process.kill()
                    self.process.wait(timeout=1)
        finally:
            self.volume_pending.clear()
            if self.state_future is not None:
                self.state_future.cancel()
            self.state_worker.shutdown(wait=False)
            if self.network_future is not None:
                self.network_future.cancel()
            if self.wifi_future is not None:
                self.wifi_future.cancel()
            self.network_worker.shutdown(wait=False)
            if self.update_future is not None:
                self.update_future.cancel()
            self.update_worker.shutdown(wait=False)
            self.storage.close()
            self.lights_off(fade=True)


def set_system_volume():
    if SYSTEM_VOLUME_COMMAND is not None:
        print(f"setting system mixer: {SYSTEM_VOLUME_COMMAND}", flush=True)
        try:
            subprocess.run(
                SYSTEM_VOLUME_COMMAND, check=True, stdin=subprocess.DEVNULL, timeout=5,
            )
        except (OSError, subprocess.SubprocessError) as error:
            print(f"could not set system mixer; continuing: {error}", file=sys.stderr, flush=True)


def main():
    # keep hardware imports out of the socket-only client path.
    import board
    import adafruit_ssd1306
    from adafruit_seesaw import digitalio, neopixel, rotaryio, seesaw

    # normal termination should run the same fade/cleanup as ctrl-c.
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))

    set_system_volume()

    i2c = board.I2C()
    oled = pixel = menu = None
    try:
        oled = adafruit_ssd1306.SSD1306_I2C(128, 32, i2c, addr=0x3C)
        device = seesaw.Seesaw(i2c, addr=0x36)
        product = (device.get_version() >> 16) & 0xFFFF
        if product != 4991:
            raise RuntimeError(f"expected encoder product 4991 at 0x36, got {product}")
        # these are seesaw pin numbers, not raspberry pi gpio numbers.
        device.pin_mode(24, device.INPUT_PULLUP)
        button = digitalio.DigitalIO(device, 24)
        encoder = rotaryio.IncrementalEncoder(device)
        pixel = neopixel.NeoPixel(device, 6, 1)
        motion = EncoderMotion()
        menu = Menu(oled, pixel, time.monotonic(), button_pressed=not button.value)
        print("menu ready: turn to select, press to run. ctrl-c to exit.", flush=True)
        while not menu.shutdown_requested:
            position = encoder.position
            pressed = not button.value
            now = time.monotonic()
            delta = motion.update(position, now)
            menu.tick(now, delta, pressed)
            time.sleep(POLL_SECONDS)
    except KeyboardInterrupt:
        print("\nstopped.")
    finally:
        try:
            if menu is not None:
                menu.close()
            else:
                try:
                    if pixel is not None:
                        pixel.fill((0, 0, 0))
                finally:
                    if oled is not None:
                        oled.poweroff()
        finally:
            i2c.deinit()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="oled menu and charnel/rathole socket control")
    parser.add_argument(
        "--send",
        choices=[action for _, action, _ in COMMANDS if isinstance(action, str)]
                + ["volume_up", "volume_down", "get_state"],
        help="send one socket command without starting the hardware ui",
    )
    args = parser.parse_args()
    if args.send:
        sys.exit(send_socket_command(args.send))

    main()
